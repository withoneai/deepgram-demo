"use client";

import { useState } from "react";
import type { Entry, Receipt } from "@/lib/use-voice-agent";

type ToolEntry = Extract<Entry, { kind: "tool" }>;

const APP: Record<string, string> = { "google-calendar": "calendar", gmail: "email", attio: "Attio", notion: "Notion" };
const appName = (platform?: string) => (platform ? APP[platform] ?? platform : "your apps");
const logo = (platform?: string) => `https://assets.withone.ai/connectors/${platform || "one"}.svg`;

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
    case "calendar_upcoming_events": {
      const span = args.days_ahead ? `the next ${count(Number(args.days_ahead), "day")}` : "the next couple of days";
      return {
        doing: args.search ? `Looking for "${args.search}" on your calendar` : `Checking your calendar for ${span}`,
        done: args.search ? `Looked for "${args.search}" on your calendar` : `Checked your calendar for ${span}`,
        outcome: Array.isArray(c) ? (c.length ? count(c.length, "event") : "Nothing scheduled") : undefined,
      };
    }
    case "calendar_check_availability":
      return {
        doing: "Checking when you're free",
        done: "Checked when you're free",
        outcome: c?.busy ? (c.busy.length ? `${count(c.busy.length, "busy block")}` : "Wide open") : undefined,
      };
    case "calendar_create_event":
      return {
        doing: `Adding "${args.title ?? "event"}" to your calendar`,
        done: `Added "${args.title ?? "event"}" to your calendar`,
        blocked: `Couldn't add "${args.title ?? "event"}" to your calendar`,
        outcome: c?.created ? "Booked" : undefined,
      };
    case "email_unread":
      return {
        doing: args.from ? `Checking email from ${args.from}` : "Checking your unread email",
        done: args.from ? `Checked email from ${args.from}` : "Checked your unread email",
        outcome: c?.emails ? (c.emails.length ? count(c.emails.length, "unread email") : "Inbox is clear") : undefined,
      };
    case "crm_lookup":
      return {
        doing: `Looking up ${args.query ?? "someone"} in Attio`,
        done: `Looked up ${args.query ?? "someone"} in Attio`,
        outcome: Array.isArray(c) ? (c.length ? `Found ${count(c.length, "match", "matches")}` : "No match") : undefined,
      };
    case "crm_recent": {
      const kind = args.kind === "companies" ? "companies" : "people";
      return {
        doing: `Checking the newest ${kind} in Attio`,
        done: `Checked the newest ${kind} in Attio`,
        outcome: Array.isArray(c) && c[0]?.name ? `Latest: ${c[0].name}` : Array.isArray(c) ? "Nothing yet" : undefined,
      };
    }
    case "notion_search": {
      const q = String(args.query ?? "").trim();
      return {
        doing: q ? `Searching Notion for "${q}"` : "Opening your recent Notion pages",
        done: q ? `Searched Notion for "${q}"` : "Opened your recent Notion pages",
        outcome: c?.opened?.title ? `Opened "${c.opened.title}"` : c?.matches ? (c.matches.length ? count(c.matches.length, "page") : "No pages found") : undefined,
      };
    }
    case "notion_read_page":
      return { doing: "Reading the Notion page", done: "Read the Notion page", outcome: c?.content ? "Got the content" : undefined };
    case "find_actions":
      return { doing: `Figuring out how to do that in ${appName(args.platform)}`, done: `Figured out how to do that in ${appName(args.platform)}`, minor: true };
    case "get_action_details":
      return { doing: "Reading up on the next step", done: "Read up on the next step", minor: true };
    case "run_action": {
      const title = r?.actionTitle
        ? r.actionTitle.replace(/\s*\([^)]*\)/g, "").replace(/’/g, "'").replace(/^(\w)/, (m) => m.toLowerCase())
        : "the task";
      const items = Array.isArray(c) ? c.length : Array.isArray(c?.results) ? c.results.length : undefined;
      return {
        doing: `Working in ${appName(args.platform)}`,
        done: r?.actionTitle ? `${appName(args.platform) === "email" ? "Email" : appName(args.platform)}: ${title}` : `Worked in ${appName(args.platform)}`,
        outcome: items !== undefined ? (items ? count(items, "result") : "Nothing found") : undefined,
      };
    }
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
  const platform = r?.platform || (typeof args.platform === "string" ? args.platform : undefined) || platformFor(entry.name);
  const text = describe(entry.name, args, r);
  const state = entry.pending ? "pending" : r?.blockedByGrant ? "blocked" : r?.ok ? "ok" : "failed";

  const headline = entry.pending ? `${text.doing}…` : state === "blocked" ? text.blocked ?? `Couldn't do that in ${appName(platform)}` : text.done;
  const sub =
    state === "blocked"
      ? `You've only allowed viewing here. One stopped it before it reached ${appName(platform) === "email" ? "Gmail" : appName(platform)}.`
      : state === "failed"
        ? "That didn't work"
        : state === "ok"
          ? [text.outcome, r ? `${(r.ms / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · ")
          : "";

  if (text.minor && state !== "failed") {
    return (
      <div className="rise flex items-center gap-2 pl-3 text-[12px] text-mute">
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

function platformFor(name: string) {
  if (name.startsWith("calendar_")) return "google-calendar";
  if (name === "email_unread") return "gmail";
  if (name === "crm_lookup") return "attio";
  return undefined;
}
