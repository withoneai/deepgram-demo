"use client";

import { ConnectButton } from "@withone/connect/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceAgent, type Entry, type Status } from "@/lib/use-voice-agent";
import { ToolCard } from "@/components/tool-card";

type Access = { policy: "full" } | { policy: "methods"; methods: string[] } | { policy: "actions"; actions: { title: string }[] };

type Config = {
  loadedAt?: number;
  mode: "connect" | "key";
  user: { name?: string; email?: string } | null;
  deepgramReady: boolean;
  error?: string;
  connections: { platform: string; title?: string; access: Access }[];
  tools: { name: string; platform: string; actionTitle: string; write: boolean }[];
  settings: { agent: { think: { provider: { type: string; model: string }; functions: unknown[] } } };
};

const logo = (platform: string) => `https://assets.withone.ai/connectors/${platform || "one"}.svg`;

const PLATFORM_NAMES: Record<string, string> = { "google-calendar": "Google Calendar", attio: "Attio", gmail: "Gmail", notion: "Notion" };

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
    setConfig({ ...(await fetch(`/api/agent/config?tz=${encodeURIComponent(tz)}`).then((r) => r.json())), loadedAt: Date.now() });
  }, []);

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
                appTheme="dark"
                platforms={["google-calendar", "attio", "gmail"]}
                moreCount={250}
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
                    <div className="truncate text-[13px]">{c.title || PLATFORM_NAMES[c.platform] || c.platform}</div>
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

          <section className="flex flex-col gap-3">
            <Label>What the agent can do</Label>
            {config?.tools.map((t) => (
              <div key={t.name} className="flex items-start gap-3">
                <img src={logo(t.platform)} alt="" className="mt-0.5 size-4 shrink-0 opacity-90" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12px]">{t.name}</div>
                  <div className="text-[11px] text-mute">{t.actionTitle}</div>
                </div>
                <span className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-mute">{t.write ? "WRITE" : "READ"}</span>
              </div>
            ))}
            {config && config.tools.length === 0 && <p className="text-[12px] text-mute">Connect an app to unlock tools.</p>}
          </section>

          {config?.error && <p className="rounded-lg border border-alert/40 p-3 text-[12px] text-alert">{config.error}</p>}
        </aside>

        {/* Conversation */}
        <section className="flex min-h-0 flex-col border-line lg:border-r">
          <div className="flex flex-col items-center gap-5 px-6 pb-6 pt-10">
            <Orb status={agent.status} level={agent.level} />
            <StatusLine status={agent.status} />
            <button
              onClick={live ? agent.stop : () => agent.start(config ?? undefined)}
              disabled={!config?.deepgramReady}
              className={
                live
                  ? "rounded-full border border-line px-6 py-2.5 text-[14px] text-ink transition hover:bg-panel-2"
                  : "rounded-full bg-lime px-6 py-2.5 text-[14px] font-medium text-[#14200A] transition hover:brightness-95 disabled:opacity-40"
              }
            >
              {live ? "End call" : "Start call"}
            </button>
            {agent.entries.length > 0 && (
              <button onClick={agent.reset} className="-mt-2 text-[12px] text-mute underline-offset-4 hover:text-ink hover:underline">
                Reset chat
              </button>
            )}
          </div>
          <Transcript entries={agent.entries} />
          <Composer disabled={!live} onSay={agent.say} />
        </section>

        {/* What Deepgram receives */}
        <aside className="flex min-h-0 flex-col gap-6 p-6">
          <Inspector config={config} entries={agent.entries} />
        </aside>
      </main>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{children}</div>;
}

function Dot({ on }: { on: boolean }) {
  return <span className={`inline-block size-1.5 rounded-full ${on ? "bg-spring" : "bg-faint"}`} />;
}

function Orb({ status, level }: { status: Status; level: number }) {
  const active = status === "listening" || status === "speaking" || status === "thinking";
  const scale = status === "listening" ? 1 + Math.min(level * 2.2, 0.35) : 1;
  return (
    <div className="relative grid size-40 place-items-center">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(63,227,165,.28), rgba(63,227,165,0) 68%)",
          animation: active ? "breathe 2.4s ease-in-out infinite" : undefined,
          opacity: active ? 1 : 0.25,
        }}
      />
      {status === "thinking" && (
        <div className="absolute inset-3 rounded-full border border-transparent border-t-spring/70" style={{ animation: "spin 1s linear infinite" }} />
      )}
      <div
        className="size-24 rounded-full border border-line transition-transform duration-100"
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
  idle: "Press start and talk. Try: “What’s on my calendar tomorrow?”",
  connecting: "Connecting to Deepgram…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Something went wrong. See below.",
};

function StatusLine({ status }: { status: Status }) {
  return <div className={`h-5 text-[13px] ${status === "error" ? "text-alert" : "text-mute"}`}>{STATUS_TEXT[status]}</div>;
}

function Transcript({ entries }: { entries: Entry[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries]);
  return (
    <div className="scroll-thin flex min-h-[240px] flex-1 flex-col gap-3 overflow-y-auto [&>*]:shrink-0 px-6 pb-4 ">
      {entries.map((e) => {
        if (e.kind === "user")
          return (
            <div key={e.id} className="rise self-end max-w-[80%] rounded-2xl rounded-br-md bg-panel-2 px-4 py-2.5 text-[14px] leading-relaxed">
              {e.text}
            </div>
          );
        if (e.kind === "agent")
          return (
            <div key={e.id} className="rise max-w-[85%] text-[14px] leading-relaxed text-ink">
              {e.text}
            </div>
          );
        if (e.kind === "system")
          return (
            <div key={e.id} className={`rise text-[12px] ${e.tone === "error" ? "text-alert" : "text-mute"}`}>
              {e.text}
            </div>
          );
        if (e.kind === "tool") return <ToolCard key={e.id} entry={e} />;
        return null;
      })}
      <div ref={end} />
    </div>
  );
}

function Composer({ disabled, onSay }: { disabled: boolean; onSay: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="border-t border-line px-6 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSay(text);
        setText("");
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        placeholder={disabled ? "Start a call to talk or type" : "Or type a turn and press enter"}
        className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-[14px] outline-none placeholder:text-faint focus:border-spring/50 disabled:opacity-50"
      />
    </form>
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
