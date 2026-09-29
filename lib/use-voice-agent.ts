"use client";

import { useCallback, useRef, useState } from "react";

// The local relay (relay.mjs) forwards to wss://agent.deepgram.com/v1/agent/converse
// with the API key attached server-side.
const RELAY_PORT = 3031;
const OUTPUT_RATE = 24000;

export type Status = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type Receipt = {
  tool: string;
  platform: string;
  actionTitle: string;
  actionId: string;
  method: string;
  path: string;
  args: Record<string, unknown>;
  ok: boolean;
  status: number;
  blockedByGrant: boolean;
  ms: number;
  content: unknown;
};

export type Entry =
  | { id: string; kind: "user" | "agent"; text: string }
  | { id: string; kind: "system"; text: string; tone: "info" | "error" }
  | { id: string; kind: "tool"; name: string; args: string; pending: boolean; receipt?: Receipt };

let seq = 0;
const nextId = () => `e${++seq}`;

export function useVoiceAgent() {
  const [status, setStatus] = useState<Status>("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [level, setLevel] = useState(0);

  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const playhead = useRef(0);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const live = useRef(false);
  const injected = useRef<string | null>(null);

  const push = useCallback((e: Entry) => setEntries((all) => [...all, e]), []);
  const patch = useCallback(
    (id: string, next: Partial<Entry>) => setEntries((all) => all.map((e) => (e.id === id ? ({ ...e, ...next } as Entry) : e))),
    [],
  );

  const stopPlayback = useCallback(() => {
    for (const s of sources.current) {
      try {
        s.stop();
      } catch {}
    }
    sources.current = [];
    playhead.current = 0;
  }, []);

  const play = useCallback((buf: ArrayBuffer) => {
    const ac = ctx.current;
    if (!ac) return;
    const pcm = new Int16Array(buf);
    if (!pcm.length) return;
    const audio = ac.createBuffer(1, pcm.length, OUTPUT_RATE);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ac.createBufferSource();
    src.buffer = audio;
    src.connect(ac.destination);
    const at = Math.max(ac.currentTime + 0.02, playhead.current);
    src.start(at);
    playhead.current = at + audio.duration;
    sources.current.push(src);
    src.onended = () => {
      sources.current = sources.current.filter((s) => s !== src);
    };
  }, []);

  const stop = useCallback(() => {
    live.current = false;
    ws.current?.close();
    ws.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    stopPlayback();
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    setLevel(0);
    setStatus((s) => (s === "error" ? s : "idle"));
  }, [stopPlayback]);

  const fail = useCallback(
    (text: string) => {
      push({ id: nextId(), kind: "system", text, tone: "error" });
      setStatus("error");
      stop();
    },
    [push, stop],
  );

  const runFunction = useCallback(
    async (fn: { id: string; name: string; arguments: string; client_side: boolean }, timeZone: string) => {
      if (!fn.client_side) return; // Deepgram ran it server-side.
      const entryId = nextId();
      push({ id: entryId, kind: "tool", name: fn.name, args: fn.arguments, pending: true });
      let receipt: Receipt | undefined;
      try {
        const res = await fetch("/api/tools/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: fn.name, arguments: fn.arguments, timeZone }),
        });
        receipt = await res.json();
      } catch (e) {
        receipt = undefined;
      }
      patch(entryId, { pending: false, receipt } as Partial<Entry>);
      ws.current?.send(
        JSON.stringify({
          type: "FunctionCallResponse",
          id: fn.id,
          name: fn.name,
          content: JSON.stringify(receipt?.content ?? { error: "The tool call failed before reaching One." }),
        }),
      );
    },
    [push, patch],
  );

  /** `preloaded` is the page's own copy of /api/agent/config; reused while fresh to skip a round trip. */
  const start = useCallback(async (preloaded?: { settings: unknown; loadedAt?: number }) => {
    if (live.current) return;
    live.current = true;
    setEntries([]);
    setStatus("connecting");
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      const fresh = preloaded?.settings && preloaded.loadedAt && Date.now() - preloaded.loadedAt < 5 * 60_000;
      const config = fresh ? preloaded : await fetch(`/api/agent/config?tz=${encodeURIComponent(timeZone)}`).then((r) => r.json());

      const ac = new AudioContext();
      ctx.current = ac;
      await ac.audioWorklet.addModule("/pcm-worklet.js");
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      stream.current = media;
      const node = new AudioWorkletNode(ac, "pcm-worklet");
      const mute = ac.createGain();
      mute.gain.value = 0;
      ac.createMediaStreamSource(media).connect(node);
      node.connect(mute).connect(ac.destination);

      let ready = false;
      let lastLevel = 0;
      node.port.onmessage = (e) => {
        if (ready && ws.current?.readyState === WebSocket.OPEN) ws.current.send(e.data.pcm);
        const now = performance.now();
        if (now - lastLevel > 80) {
          lastLevel = now;
          setLevel(e.data.level);
        }
      };

      const socket = new WebSocket(`ws://${location.hostname}:${RELAY_PORT}`);
      socket.binaryType = "arraybuffer";
      ws.current = socket;

      socket.onmessage = (ev) => {
        if (typeof ev.data !== "string") return play(ev.data);
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "Welcome":
            socket.send(JSON.stringify(config.settings));
            break;
          case "SettingsApplied":
            ready = true;
            setStatus("listening");
            break;
          case "ConversationText":
            // A typed turn is shown when sent; skip Deepgram's echo of it.
            if (msg.role === "user" && injected.current === msg.content) {
              injected.current = null;
              break;
            }
            push({ id: nextId(), kind: msg.role === "user" ? "user" : "agent", text: msg.content });
            break;
          case "UserStartedSpeaking":
            stopPlayback();
            setStatus("listening");
            break;
          case "AgentThinking":
            setStatus("thinking");
            break;
          case "AgentStartedSpeaking":
            setStatus("speaking");
            break;
          case "AgentAudioDone": {
            const wait = Math.max(0, (playhead.current - (ctx.current?.currentTime ?? 0)) * 1000);
            setTimeout(() => live.current && setStatus((s) => (s === "speaking" ? "listening" : s)), wait);
            break;
          }
          case "FunctionCallRequest":
            setStatus("thinking");
            for (const fn of msg.functions ?? []) runFunction(fn, timeZone);
            break;
          case "Error":
            fail(`Deepgram: ${msg.description ?? msg.message ?? JSON.stringify(msg)}`);
            break;
          case "Warning":
            push({ id: nextId(), kind: "system", text: `Deepgram: ${msg.description ?? JSON.stringify(msg)}`, tone: "info" });
            break;
        }
      };
      socket.onerror = () => fail("Could not reach the Deepgram relay. Is `npm run dev` running both processes?");
      socket.onclose = (ev) => {
        if (live.current && ev.code !== 1000) fail(`Deepgram closed the session (${ev.code}${ev.reason ? `: ${ev.reason}` : ""}).`);
      };
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [fail, play, push, runFunction, stopPlayback]);

  /** Types a turn instead of speaking it. Handy on a noisy call. */
  const say = useCallback(
    (text: string) => {
      if (ws.current?.readyState !== WebSocket.OPEN || !text.trim()) return;
      injected.current = text.trim();
      push({ id: nextId(), kind: "user", text: text.trim() });
      ws.current.send(JSON.stringify({ type: "InjectUserMessage", content: text.trim() }));
    },
    [push],
  );

  /** Ends any call and clears the conversation. The next call starts fresh. */
  const reset = useCallback(() => {
    stop();
    injected.current = null;
    setEntries([]);
    setStatus("idle");
  }, [stop]);

  return { status, entries, level, start, stop, say, reset };
}
