"use client";

import { useState } from "react";
import type { Entry, Receipt } from "@/lib/use-voice-agent";
import { logo, platformName } from "@/lib/platforms";

type ToolEntry = Extract<Entry, { kind: "tool" }>;

/** How a card names an app: "your calendar" reads better than "Google Calendar" mid-sentence. */
const SPOKEN: Record<string, string> = { "google-calendar": "calendar", gmail: "email" };
const appName = (platform?: string) => (platform ? SPOKEN[platform] ?? platformName(platform) : "your apps");

function parse(s: string): Record<string, any> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Plain-English "what I'm doing" and "what came back" for a tool call. */
function describe(name: string, args: Record<string, any>, r?: Receipt): { doing: string; done: string; blocked?: string; outcome?: string; minor?: boolean } {
  const c: any = r?.content;
  switch (name) {
    case "find_actions": {
      const apps = [...new Set<string>((args.requests ?? [{ platform: args.platform }]).map((q: any) => q?.platform).filter(Boolean))].map(platformName);
      const where = apps.length ? apps.join(" and ") : "your apps";
      return { doing: `Looking up how to do that in ${where}`, done: `Found the way to do it in ${where}`, minor: true };
    }
    case "get_action_details":
      return { doing: "Reading up on another way to do it", done: "Read up on another way to do it", minor: true };
    case "run_action": {
      const title = r?.actionTitle
        ? r.actionTitle.replace(/\s*\([^)]*\)/g, "").replace(/’/g, "'").replace(/^(\w)/, (m) => m.toLowerCase())
        : "the task";
      const items = Array.isArray(c) ? c.length : Array.isArray(c?.results) ? c.results.length : undefined;
      return {
        doing: `Working in ${appName(args.platform)}`,
        done: r?.actionTitle ? `${platformName(args.platform)}: ${title}` : `Worked in ${appName(args.platform)}`,
        outcome: items !== undefined ? (items ? count(items, "result") : "Nothing found") : undefined,
      };
    }
    case "search_people": {
      const n = Array.isArray(c?.people) ? c.people.length : undefined;
      return {
        doing: `Searching Attio for "${args.query ?? ""}"`,
        done: `Attio: searched people for "${args.query ?? ""}"`,
        outcome: n !== undefined ? (n ? count(n, "person", "people") : "Nobody found") : undefined,
      };
    }
    case "draft_email":
      return { doing: `Drafting an email to ${args.to ?? "them"}`, done: `Gmail: saved a draft to ${args.to ?? "them"}`, outcome: c?.saved ? `"${args.subject ?? ""}"` : undefined };
    default:
      return { doing: `Working in ${appName(r?.platform)}`, done: `Worked in ${appName(r?.platform)}` };
  }
}

function StatusIcon({ state }: { state: "pending" | "ok" | "blocked" | "failed" }) {
  if (state === "pending")
    return <span className="size-3.5 rounded-full border-[1.5px] border-line border-t-spring" style={{ animation: "spin .8s linear infinite" }} />;
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (state === "ok")
    return (
      <svg {...common} stroke="currentColor" className="text-spring">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    );
  if (state === "blocked")
    return (
      <svg {...common} stroke="currentColor" className="text-[#f2b35a]">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d="M5.5 7V5.25a2.5 2.5 0 015 0V7" />
      </svg>
    );
  return (
    <svg {...common} stroke="currentColor" className="text-alert">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

export function ToolCard({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const r = entry.receipt;
  const args = parse(entry.args);
  const platform = r?.platform || (typeof args.platform === "string" ? args.platform : undefined) || args.requests?.[0]?.platform;
  const text = describe(entry.name, args, r);
  // A write the agent tried before asking: not a failure, the guard doing its job.
  const asking = (r?.content as any)?.error === "needs_confirmation";
  const state = entry.pending ? "pending" : r?.blockedByGrant ? "blocked" : r?.ok || asking ? "ok" : "failed";

  if (asking) {
    return (
      <div className="rise flex items-center gap-2 text-[12px] text-mute">
        <StatusIcon state="ok" />
        <span>Checking with you before changing anything in {appName(platform)}</span>
      </div>
    );
  }

  const headline = entry.pending ? `${text.doing}…` : state === "blocked" ? text.blocked ?? `Couldn't do that in ${appName(platform)}` : text.done;
  const sub =
    state === "blocked"
      ? `You've only allowed viewing here. One stopped it before it reached ${platformName(platform)}.`
      : state === "failed"
        ? "That didn't work"
        : state === "ok"
          ? [text.outcome, r ? `${(r.ms / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · ")
          : "";

  if (text.minor && state !== "failed") {
    return (
      <div className="rise flex items-center gap-2 text-[12px] text-mute">
        <StatusIcon state={state} />
        <span>{headline}</span>
      </div>
    );
  }

  return (
    <div
      className={`rise overflow-hidden rounded-xl border bg-panel transition-colors ${
        state === "blocked" ? "border-[#f2b35a]/30" : state === "failed" ? "border-alert/30" : "border-line"
      }`}
    >
      <button onClick={() => r && setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-panel-2">
          <img src={logo(platform)} alt="" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink">{headline}</span>
          {sub && <span className={`block text-[12px] ${state === "blocked" ? "text-[#f2b35a]/90" : "truncate text-mute"}`}>{sub}</span>}
        </span>
        <StatusIcon state={state} />
        {r && (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {open && r && (
        <div className="border-t border-line bg-carbon/60 px-3 py-3 font-mono text-[11px] leading-relaxed text-mute">
          <div className="text-ink/80">
            {r.method} {r.path}
          </div>
          <div className="mt-1">
            {r.actionTitle} · {r.status || "no response"} · {r.ms} ms
          </div>
          <pre className="scroll-thin mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-ink/70">{JSON.stringify(r.content, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
