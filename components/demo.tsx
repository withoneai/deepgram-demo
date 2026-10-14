"use client";

import { ConnectButton } from "@withone/connect/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceAgent, type Entry, type Status } from "@/lib/use-voice-agent";
import { ToolCard } from "@/components/tool-card";
import { logo, platformName } from "@/lib/platforms";

type Access = { policy: "full" } | { policy: "methods"; methods: string[] } | { policy: "actions"; actions: { title: string }[] };

type Config = {
  loadedAt?: number;
  mode: "connect" | "key";
  user: { name?: string; email?: string } | null;
  deepgramReady: boolean;
  error?: string;
  connections: { platform: string; title?: string; access: Access }[];
  featuredPlatforms: string[];
  tools: { name: string; platform: string; actionTitle: string; write: boolean; custom?: boolean }[];
  model: string;
  models: { id: string; label: string; note: string }[];
  settings: { agent: { think: { provider: { type: string; model: string }; functions: unknown[] } } };
};



function accessLabel(access: Access) {
  if (access.policy === "full") return "Full access";
  if (access.policy === "methods") return access.methods.every((m) => m === "GET") ? "Read only" : access.methods.join(", ");
  return `${access.actions.length} action${access.actions.length === 1 ? "" : "s"}`;
}

export function Demo() {
  const [config, setConfig] = useState<Config | null>(null);
  const agent = useVoiceAgent();

  const load = useCallback(async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const model = localStorage.getItem(MODEL_KEY) ?? "";
    setConfig({ ...(await fetch(`/api/agent/config?tz=${encodeURIComponent(tz)}&model=${encodeURIComponent(model)}`).then((r) => r.json())), loadedAt: Date.now() });
  }, []);

  const chooseModel = (id: string) => {
    localStorage.setItem(MODEL_KEY, id);
    load();
  };

  useEffect(() => {
    load();
  }, [load]);

  const [disconnecting, setDisconnecting] = useState(false);
  const disconnect = async () => {
    setDisconnecting(true);
    agent.reset();
    await fetch("/api/disconnect", { method: "POST" });
    await load();
    setDisconnecting(false);
  };
  const connected = (config?.connections.length ?? 0) > 0;

  const live = agent.status !== "idle" && agent.status !== "error";

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="flex items-center gap-3 text-[15px] font-medium tracking-tight">
          <span>Deepgram</span>
          <span className="text-faint">×</span>
          <span>One</span>
          <span className="ml-2 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-normal text-mute">Voice Agent with Connect</span>
        </div>
        {config && (
          <div className="flex items-center gap-2 text-[12px] text-mute">
            <Dot on={config.deepgramReady} />
            <span>{config.deepgramReady ? "Deepgram ready" : "Deepgram key missing"}</span>
            <span className="mx-2 text-faint">·</span>
            {connected ? (
              <span className="flex items-center gap-2">
                <img src={logo("one")} alt="" className="size-3.5" />
                <span className="text-ink">{config.user?.name ?? config.user?.email ?? (config.mode === "connect" ? "Connected to One" : "Your One key")}</span>
                {config.user?.name && config.user.email && <span className="text-faint">{config.user.email}</span>}
              </span>
            ) : (
              <span>{config.mode === "connect" ? "Not connected to One" : "Your One key"}</span>
            )}
            {config.mode === "connect" && connected && (
              <button
                onClick={disconnect}
                disabled={disconnecting}
                className="ml-3 rounded-full border border-line px-3 py-1 text-[12px] text-ink transition hover:bg-panel-2 disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect from One"}
              </button>
            )}
          </div>
        )}
      </header>

      <main className="grid grid-cols-1 lg:h-[calc(100dvh-57px)] lg:grid-cols-[320px_1fr_400px]">
        {/* Tools: the Connect embed */}
        <aside className="scroll-thin flex min-h-0 flex-col gap-6 overflow-y-auto border-line p-6 lg:border-r">
          <section className="flex flex-col gap-3">
            <Label>Your tools</Label>
            {config?.mode === "connect" && !connected && (
              <ConnectButton
                key={String(connected)}
                authorizeUrl="/api/one/authorize"
                variant="block"
                theme="dark"
                connectTheme="dark"
                platforms={config.featuredPlatforms}
                description="Your connections stay in your One account. Revoke access at any time."
                onSuccess={load}
                onError={(m) => alert(m)}
              />
            )}
            {config?.mode === "key" && (
              <p className="text-[12px] leading-relaxed text-mute">
                Running on your own One key. Add a Connect app in <span className="text-ink">.env.local</span> so each visitor brings their own apps.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {config?.connections.map((c) => (
                <div key={c.platform} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5">
                  <img src={logo(c.platform)} alt="" className="size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{c.title || platformName(c.platform)}</div>
                    <div className="text-[11px] text-mute">{accessLabel(c.access)}</div>
                  </div>
                  <Dot on />
                </div>
              ))}
              {config && config.connections.length === 0 && (
                <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-mute">No tools connected yet.</div>
              )}
            </div>
          </section>

          {config?.models && (
            <section className="flex flex-col gap-3">
              <Label>Model</Label>
              <select
                value={config.model}
                onChange={(e) => chooseModel(e.target.value)}
                disabled={live}
                className="rounded-xl border border-line bg-panel px-3 py-2.5 text-[13px] text-ink outline-none disabled:opacity-50"
              >
                {config.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-mute">
                {live ? "Applies to your next call." : config.models.find((m) => m.id === config.model)?.note}
              </p>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <Label>What the agent can do</Label>
            {config?.tools.map((t) => (
              <div key={t.name} className="flex items-start gap-3">
                <img src={logo(t.platform)} alt="" className="mt-0.5 size-4 shrink-0 opacity-90" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12px]">{t.name}</div>
                  <div className="text-[11px] text-mute">{t.actionTitle}</div>
                </div>
                {t.custom && <span className="rounded border border-spring/40 px-1.5 py-px font-mono text-[10px] text-spring">CUSTOM</span>}
                <span className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-mute">{t.write ? "WRITE" : "READ"}</span>
              </div>
            ))}
            {config && config.tools.length === 0 && <p className="text-[12px] text-mute">Connect an app to unlock tools.</p>}
          </section>

          {config?.error && <p className="rounded-lg border border-alert/40 p-3 text-[12px] text-alert">{config.error}</p>}
        </aside>

        {/* Conversation */}
        <section className="flex min-h-0 flex-col border-line lg:border-r">
          <CallBar
            compact={agent.entries.length > 0}
            status={agent.status}
            level={agent.level}
            live={live}
            ready={Boolean(config?.deepgramReady)}
            onStart={() => agent.start(config ?? undefined)}
            onStop={agent.stop}
            onReset={agent.entries.length > 0 ? agent.reset : undefined}
          />
          <Transcript entries={agent.entries} thinking={agent.status === "thinking"} />
          <Composer
            live={live}
            suggestions={live && !agent.entries.some((e) => e.kind === "user") ? suggestionsFor(config?.connections ?? []) : []}
            onSay={agent.say}
          />
        </section>

        {/* What Deepgram receives */}
        <aside className="flex min-h-0 flex-col gap-6 p-6">
          <Inspector config={config} entries={agent.entries} />
        </aside>
      </main>
    </div>
  );
}

const MODEL_KEY = "think-model";

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{children}</div>;
}

function Dot({ on }: { on: boolean }) {
  return <span className={`inline-block size-1.5 rounded-full ${on ? "bg-spring" : "bg-faint"}`} />;
}

function Orb({ status, level, size = "lg" }: { status: Status; level: number; size?: "lg" | "sm" }) {
  const active = status === "listening" || status === "speaking" || status === "thinking";
  const scale = status === "listening" ? 1 + Math.min(level * 2.2, 0.35) : 1;
  return (
    <div className={`relative grid shrink-0 place-items-center ${size === "lg" ? "size-40" : "size-10"}`}>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(63,227,165,.28), rgba(63,227,165,0) 68%)",
          animation: active ? "breathe 2.4s ease-in-out infinite" : undefined,
          opacity: active ? 1 : 0.25,
        }}
      />
      {status === "thinking" && (
        <div
          className={`absolute rounded-full border border-transparent border-t-spring/70 ${size === "lg" ? "inset-3" : "inset-0"}`}
          style={{ animation: "spin 1s linear infinite" }}
        />
      )}
      <div
        className={`rounded-full border border-line transition-transform duration-100 ${size === "lg" ? "size-24" : "size-6"}`}
        style={{
          transform: `scale(${scale})`,
          background:
            status === "speaking"
              ? "radial-gradient(circle at 35% 30%, #3fe3a5, #0d6e52 70%)"
              : active
                ? "radial-gradient(circle at 35% 30%, #1d2a25, #111413 70%)"
                : "radial-gradient(circle at 35% 30%, #1a1e1c, #0f1211 70%)",
        }}
      />
    </div>
  );
}

const STATUS_TEXT: Record<Status, string> = {
  idle: "Start a call, then talk or type.",
  connecting: "Connecting to Deepgram…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Something went wrong. See below.",
};

/** The big orb before anything is said; a slim bar once the conversation needs the room. */
function CallBar(props: {
  compact: boolean;
  status: Status;
  level: number;
  live: boolean;
  ready: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset?: () => void;
}) {
  const { compact, status, level, live, ready, onStart, onStop, onReset } = props;
  const button = (
    <button
      onClick={live ? onStop : onStart}
      disabled={!ready && !live}
      className={
        live
          ? "rounded-full border border-line px-5 py-2 text-[13px] text-ink transition hover:bg-panel-2"
          : "rounded-full bg-lime px-5 py-2 text-[13px] font-medium text-[#14200A] transition hover:brightness-95 disabled:opacity-40"
      }
    >
      {live ? "End call" : "Start call"}
    </button>
  );
  const statusText = <span className={`text-[13px] ${status === "error" ? "text-alert" : "text-mute"}`}>{STATUS_TEXT[status]}</span>;

  if (!compact) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-10">
        <Orb status={status} level={level} />
        {statusText}
        {button}
      </div>
    );
  }
  return (
    <div className="border-b border-line px-6 py-3">
      <div className="mx-auto flex w-full max-w-[680px] items-center gap-3">
        <Orb status={status} level={level} size="sm" />
        <div className="flex-1">{statusText}</div>
        {onReset && (
          <button onClick={onReset} className="text-[12px] text-mute underline-offset-4 hover:text-ink hover:underline">
            Clear
          </button>
        )}
        {button}
      </div>
    </div>
  );
}

/** Consecutive agent replies and tool steps read as one turn, under one avatar. */
type Turn = { id: string; kind: "user"; text: string } | { id: string; kind: "agent"; items: Entry[] } | { id: string; kind: "system"; entry: Extract<Entry, { kind: "system" }> };

function toTurns(entries: Entry[]): Turn[] {
  const turns: Turn[] = [];
  for (const e of entries) {
    if (e.kind === "user") turns.push({ id: e.id, kind: "user", text: e.text });
    else if (e.kind === "system") turns.push({ id: e.id, kind: "system", entry: e });
    else {
      const last = turns[turns.length - 1];
      if (last?.kind === "agent") last.items.push(e);
      else turns.push({ id: e.id, kind: "agent", items: [e] });
    }
  }
  return turns;
}

function Transcript({ entries, thinking }: { entries: Entry[]; thinking: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, thinking]);
  if (!entries.length) return null;
  const turns = toTurns(entries);
  const last = turns[turns.length - 1];
  // Waiting on the agent: after the user spoke, or after a step finished with nothing said yet.
  const waiting = thinking && (last?.kind === "user" || (last?.kind === "agent" && last.items[last.items.length - 1]?.kind === "tool"));

  return (
    <div className="scroll-thin min-h-[240px] flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5">
        {turns.map((t) => {
          if (t.kind === "user")
            return (
              <div key={t.id} className="rise max-w-[80%] self-end rounded-2xl rounded-br-md bg-panel-2 px-4 py-2.5 text-[14px] leading-relaxed">
                {t.text}
              </div>
            );
          if (t.kind === "system")
            return (
              <div key={t.id} className={`rise text-center text-[12px] ${t.entry.tone === "error" ? "text-alert" : "text-mute"}`}>
                {t.entry.text}
              </div>
            );
          const trailing = t === last && waiting;
          return (
            <div key={t.id} className="rise flex gap-3">
              <AgentAvatar />
              <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                {t.items.map((e) =>
                  e.kind === "tool" ? (
                    <ToolCard key={e.id} entry={e} />
                  ) : e.kind === "agent" ? (
                    <p key={e.id} className="text-[14px] leading-relaxed text-ink">
                      {e.text}
                    </p>
                  ) : null,
                )}
                {trailing && <TypingDots />}
              </div>
            </div>
          );
        })}
        {waiting && last?.kind === "user" && (
          <div className="rise flex gap-3">
            <AgentAvatar />
            <div className="pt-1.5">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
    </div>
  );
}

function AgentAvatar() {
  return <span className="mt-0.5 size-6 shrink-0 rounded-full border border-line" style={{ background: "radial-gradient(circle at 35% 30%, #3fe3a5, #0d6e52 70%)" }} />;
}

function TypingDots() {
  return (
    <span className="flex h-5 items-center gap-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 rounded-full bg-mute" style={{ animation: `blink 1.2s ${i * 0.15}s ease-in-out infinite` }} />
      ))}
    </span>
  );
}

/** First things to try, from what the user actually connected. */
const SUGGEST: Record<string, string> = {
  "google-calendar": "What's on my calendar tomorrow?",
  gmail: "Any new email worth reading?",
  linear: "What's assigned to me in Linear?",
  attio: "Who did we add to Attio recently?",
  notion: "Find my latest Notion page",
  slack: "Anything new in Slack for me?",
  github: "Any open pull requests waiting on me?",
  hubspot: "Who are my newest HubSpot contacts?",
  stripe: "How were payments this week?",
};

function suggestionsFor(connections: { platform: string }[]) {
  const picks = connections.map((c) => SUGGEST[c.platform]).filter(Boolean);
  return [...picks.slice(0, 3), "What can you do?"];
}

function Composer({ live, suggestions, onSay }: { live: boolean; suggestions: string[]; onSay: (t: string) => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (live) input.current?.focus();
  }, [live]);
  const send = (t: string) => {
    if (!t.trim()) return;
    onSay(t);
    setText("");
  };
  return (
    <div className="border-t border-line px-6 py-4">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rise rounded-full border border-line px-3 py-1.5 text-[12px] text-mute transition hover:border-spring/40 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-center gap-2 rounded-xl border border-line bg-panel py-1.5 pl-4 pr-1.5 transition focus-within:border-spring/50"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!live}
            placeholder={live ? "Talk, or type a message" : "Start a call to talk or type"}
            className="min-w-0 flex-1 bg-transparent py-1 text-[14px] outline-none placeholder:text-faint disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!live || !text.trim()}
            aria-label="Send"
            className="grid size-8 place-items-center rounded-lg bg-panel-2 text-ink transition hover:bg-line disabled:opacity-30"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function Inspector({ config, entries }: { config: Config | null; entries: Entry[] }) {
  const [tab, setTab] = useState<"functions" | "last">("functions");
  const lastTool = [...entries].reverse().find((e): e is Extract<Entry, { kind: "tool" }> => e.kind === "tool" && !e.pending);
  const body =
    tab === "functions"
      ? config?.settings.agent.think.functions ?? []
      : lastTool?.receipt
        ? {
            deepgram_called: { name: lastTool.name, arguments: safeParse(lastTool.args) },
            one_ran: { action_id: lastTool.receipt.actionId, method: lastTool.receipt.method, path: lastTool.receipt.path, status: lastTool.receipt.status, blocked_by_grant: lastTool.receipt.blockedByGrant },
            returned_to_agent: lastTool.receipt.content,
          }
        : "No tool calls yet.";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>What Deepgram sees</Label>
        {config && (
          <span className="font-mono text-[11px] text-faint">
            {config.settings.agent.think.provider.type}/{config.settings.agent.think.provider.model}
          </span>
        )}
      </div>
      <div className="flex gap-1 rounded-lg border border-line bg-panel p-1 text-[12px]">
        {(["functions", "last"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1.5 transition ${tab === t ? "bg-panel-2 text-ink" : "text-mute hover:text-ink"}`}
          >
            {t === "functions" ? "think.functions" : "Last tool call"}
          </button>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-mute">
        {tab === "functions"
          ? "Generated from One's action catalog and the tools the user connected. Deepgram gets function definitions; One holds the credentials."
          : "The round trip: Deepgram's FunctionCallRequest, the One action it became, and the trimmed result spoken back."}
      </p>
      <pre className="scroll-thin min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-panel p-4 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink/90">
        {typeof body === "string" ? body : JSON.stringify(body, null, 2)}
      </pre>
    </div>
  );
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
