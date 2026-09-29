import "server-only";
import type { ActionCall, ActionResult, Connection } from "./one";

/**
 * The voice agent's tools. Each one is a Deepgram `think.functions` entry
 * on one side and a One catalog action on the other. The agent only sees
 * tools whose platform the visitor has connected.
 *
 * Outputs are trimmed before they go back to the LLM: a voice turn should
 * read a few fields, not a 40KB calendar payload.
 */

export type Tool = {
  name: string;
  platform: string;
  actionTitle: string;
  /** Deepgram's function definition, minus the name. */
  description: string;
  parameters: Record<string, unknown>;
  /** Wait for the user to finish their turn before firing. For writes. */
  deferUntilEot?: boolean;
  build: (args: Record<string, any>, ctx: { timeZone: string }) => Omit<ActionCall, "connectionKey">;
  /** Several One calls behind one tool, for answers a voice turn needs in one hop. */
  compose?: (args: Record<string, any>, run: (call: Omit<ActionCall, "connectionKey">) => Promise<ActionResult>) => Promise<ActionResult>;
  summarize: (data: any) => unknown;
};

const DAY = 86_400_000;

const NOTION_SEARCH = "conn_mod_def::GJ5En67fz04::-CJAS419SVWm7L2l6brp6A";
const NOTION_MARKDOWN = "conn_mod_def::GJ5EntqNvy0::-VzfhSExTEGGnlXLUMqFcA";

/** A Notion page or data source's title, wherever Notion keeps it. */
export function notionTitle(r: any): string {
  const prop: any = Object.values(r?.properties ?? {}).find((p: any) => p?.type === "title");
  return ((prop?.title ?? r?.title ?? []) as any[]).map((t) => t.plain_text).join("").trim();
}

/** Markdown to something a voice model can skim: no links, images or tables noise. */
function plainExcerpt(md: string, max: number) {
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`>#|]+/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function listUnread(args: Record<string, any>): Omit<ActionCall, "connectionKey"> {
  return {
    actionId: "conn_mod_def::GJ3odOE-fdw::ijLww5s-SCSplLQtLpxkrw",
    method: "GET",
    path: "/gmail/v1/users/me/messages",
    query: {
      q: ["is:unread", "in:inbox", args.from ? `from:${String(args.from)}` : ""].filter(Boolean).join(" "),
      maxResults: String(Math.min(Math.max(Number(args.limit) || 5, 1), 8)),
    },
  };
}

export const TOOLS: Tool[] = [
  {
    name: "calendar_upcoming_events",
    platform: "google-calendar",
    actionTitle: "List a Calendar's Events",
    description: "List the user's upcoming calendar events, soonest first. Use for 'what's on my calendar', 'when is my meeting with X'.",
    parameters: {
      type: "object",
      properties: {
        days_ahead: { type: "integer", description: "How many days ahead to look, 1 to 14. Default 2." },
        search: { type: "string", description: "Optional text to match in event titles, e.g. a person or company name." },
      },
    },
    build: (args) => {
      const days = Math.min(Math.max(Number(args.days_ahead) || 2, 1), 14);
      const now = Date.now();
      const query: Record<string, string> = {
        timeMin: new Date(now).toISOString(),
        timeMax: new Date(now + days * DAY).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "10",
      };
      if (args.search) query.q = String(args.search);
      return {
        actionId: "conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA",
        method: "GET",
        path: "/calendars/primary/events",
        query,
      };
    },
    summarize: (data) =>
      (data?.items ?? []).map((e: any) => ({
        title: e.summary ?? "(no title)",
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        attendees: (e.attendees ?? []).filter((a: any) => !a.self).map((a: any) => a.displayName ?? a.email).slice(0, 5),
      })),
  },
  {
    name: "calendar_check_availability",
    platform: "google-calendar",
    actionTitle: "List a Calendar's Events",
    description: "Return the busy blocks on the user's calendar between two times, so you can find a free slot. Times are ISO 8601 with offset.",
    parameters: {
      type: "object",
      properties: {
        start: { type: "string", description: "Window start, ISO 8601 with UTC offset." },
        end: { type: "string", description: "Window end, ISO 8601 with UTC offset." },
      },
      required: ["start", "end"],
    },
    // Built on the events list (a GET), not /freeBusy (a POST), so it works on a view-only grant.
    build: (args) => ({
      actionId: "conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA",
      method: "GET",
      path: "/calendars/primary/events",
      query: {
        timeMin: new Date(args.start).toISOString(),
        timeMax: new Date(args.end).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "50",
      },
    }),
    summarize: (data) => {
      const busy = (data?.items ?? [])
        .filter((e: any) => e.status !== "cancelled" && e.transparency !== "transparent" && e.start?.dateTime)
        .filter((e: any) => !(e.attendees ?? []).some((a: any) => a.self && a.responseStatus === "declined"))
        .map((e: any) => ({ start: e.start.dateTime, end: e.end?.dateTime, title: e.summary ?? "(busy)" }));
      return { busy, free_if_empty: busy.length === 0 };
    },
  },
  {
    name: "calendar_create_event",
    platform: "google-calendar",
    actionTitle: "Create an Event in a Calendar",
    description: "Put an event on the user's calendar. Confirm the title and time out loud before calling. Times are ISO 8601 with offset.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title." },
        start: { type: "string", description: "Start, ISO 8601 with UTC offset." },
        end: { type: "string", description: "End, ISO 8601 with UTC offset." },
        description: { type: "string", description: "Optional notes." },
      },
      required: ["title", "start", "end"],
    },
    deferUntilEot: true,
    build: (args, { timeZone }) => ({
      actionId: "conn_mod_def::GJ6RlnjZAh4::CSya4eHtRbeXRM7PHiXuRA",
      method: "POST",
      path: "/v3/calendars/primary/events",
      // No attendees and no notifications: the demo never emails anyone.
      query: { sendUpdates: "none" },
      body: {
        summary: args.title,
        description: args.description ?? "Booked by voice through Deepgram + One.",
        start: { dateTime: args.start, timeZone },
        end: { dateTime: args.end, timeZone },
      },
    }),
    summarize: (data) => ({ created: Boolean(data?.id), id: data?.id, title: data?.summary, start: data?.start?.dateTime, link: data?.htmlLink }),
  },
  {
    name: "email_unread",
    platform: "gmail",
    actionTitle: "List a User's Gmail Messages",
    description: "The user's most recent unread emails with sender, subject and a snippet. Use for 'any new email', 'who emailed me', 'anything from X'.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Optional sender name or address to filter by." },
        limit: { type: "integer", description: "How many, 1 to 8. Default 5." },
      },
    },
    build: (args) => listUnread(args),
    // List ids, then fetch every message's headers in parallel: one hop for the agent.
    compose: async (args, run) => {
      const list = await run(listUnread(args));
      if (!list.ok) return list;
      const ids: string[] = ((list.data as any)?.messages ?? []).map((m: any) => m.id);
      const messages = await Promise.all(
        ids.map((id) =>
          run({
            actionId: "conn_mod_def::GJ3ocvMGOS8::D__3BgQSSzWtDUoOqLuX2A",
            method: "GET",
            path: `/gmail/v1/users/me/messages/${id}`,
            query: { format: "metadata" },
          }).then((r) => (r.ok ? r.data : null)),
        ),
      );
      return { ...list, data: { total: (list.data as any)?.resultSizeEstimate, messages } };
    },
    // Gmail's resultSizeEstimate saturates, so no count; snippets carry entities and filler glyphs.
    summarize: (data) => ({
      emails: (data?.messages ?? []).filter(Boolean).map((m: any) => {
        const header = (name: string) => m.payload?.headers?.find((h: any) => h.name.toLowerCase() === name)?.value;
        return { from: header("from"), subject: header("subject"), snippet: String(m.snippet ?? "")
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&")
            .replace(/[\u034f\u200b-\u200d\u2060\ufeff\u00ad]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 140), date: header("date") };
      }),
    }),
  },
  {
    name: "crm_recent",
    platform: "attio",
    actionTitle: "List an Object's Records",
    description: "The most recently added people or companies in the CRM, newest first. Use for 'latest contact', 'who did we add recently', 'newest companies'.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["people", "companies"], description: "People or companies. Default people." },
        limit: { type: "integer", description: "How many, 1 to 5. Default 3." },
      },
    },
    build: (args) => ({
      actionId: "conn_mod_def::GJ0CbN-LPiU::A6h6M9QkS0Cs2Lt9CdPH7Q",
      method: "POST",
      path: `/objects/${args.kind === "companies" ? "companies" : "people"}/records/query`,
      body: { limit: Math.min(Math.max(Number(args.limit) || 3, 1), 5), sorts: [{ attribute: "created_at", direction: "desc" }] },
    }),
    summarize: (data) =>
      (data?.data ?? []).map((r: any) => {
        const v = r.values ?? {};
        const first = (key: string, field: string) => v[key]?.[0]?.[field];
        return {
          name: first("name", "full_name") ?? first("name", "value"),
          email: first("email_addresses", "email_address"),
          title: first("job_title", "value"),
          domain: first("domains", "domain"),
          added: r.created_at,
        };
      }),
  },
  {
    name: "notion_search",
    platform: "notion",
    actionTitle: "Search Notion",
    description:
      "Search the user's Notion by words in the title, and open the best match. No page or database ID needed. An empty query returns the most recently edited pages, which covers 'any page', 'the root' or 'something recent'. Search with partial words if unsure of spelling (e.g. 'reach').",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Words from the page title. Empty string for recent pages." } },
      required: ["query"],
    },
    build: (args) => ({
      actionId: NOTION_SEARCH,
      method: "POST",
      path: "/search",
      body: { query: String(args.query ?? ""), page_size: 8, filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" } },
    }),
    // Search, then read the best match in the same hop so the agent can answer right away.
    compose: async (args, run) => {
      const found = await run({
        actionId: NOTION_SEARCH,
        method: "POST",
        path: "/search",
        body: { query: String(args.query ?? ""), page_size: 8, filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" } },
      });
      if (!found.ok) return found;
      const pages: any[] = (found.data as any)?.results ?? [];
      const q = String(args.query ?? "").toLowerCase();
      // Prefer a title that literally contains the query, and a Latin-script title over a translation.
      const best =
        pages.find((p) => q && notionTitle(p).toLowerCase().includes(q) && /^[\x00-\x7F’–—]*$/.test(notionTitle(p))) ??
        pages.find((p) => q && notionTitle(p).toLowerCase().includes(q)) ??
        pages.find((p) => /^[\x00-\x7F’–—]*$/.test(notionTitle(p))) ??
        pages[0];
      const opened = best ? await run({ actionId: NOTION_MARKDOWN, method: "GET", path: `/pages/${best.id}/markdown` }) : null;
      return { ...found, data: { pages, best, markdown: opened?.ok ? (opened.data as any)?.markdown : null } };
    },
    summarize: (data) => ({
      matches: (data?.pages ?? []).slice(0, 5).map((p: any) => ({ title: notionTitle(p), page_id: p.id, last_edited: p.last_edited_time })),
      opened: data?.best ? { title: notionTitle(data.best), page_id: data.best.id, content: data.markdown ? plainExcerpt(data.markdown, 1800) : "(could not read)" } : null,
    }),
  },
  {
    name: "notion_read_page",
    platform: "notion",
    actionTitle: "Retrieve a Page as Markdown",
    description: "Read a Notion page's content by its page_id (from notion_search).",
    parameters: {
      type: "object",
      properties: { page_id: { type: "string", description: "A page_id from notion_search." } },
      required: ["page_id"],
    },
    build: (args) => ({ actionId: NOTION_MARKDOWN, method: "GET", path: `/pages/${encodeURIComponent(String(args.page_id ?? ""))}/markdown` }),
    summarize: (data) => ({ content: plainExcerpt(String(data?.markdown ?? ""), 3000), truncated: Boolean(data?.truncated) }),
  },
  {
    name: "crm_lookup",
    platform: "attio",
    actionTitle: "Search Records Across Objects",
    description: "Look up a person or company in the CRM by name, email or domain. Use when the user asks who someone is or about an account.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Name, email or domain to search for." } },
      required: ["query"],
    },
    build: (args) => ({
      actionId: "conn_mod_def::GJ0CbY6VDMk::bN2lStzmS0admyNa4K83hg",
      method: "POST",
      path: "/objects/records/search",
      body: { query: String(args.query), objects: ["people", "companies"], request_as: { type: "workspace" }, limit: 5 },
    }),
    summarize: (data) =>
      (data?.data ?? []).map((r: any) => ({
        name: r.record_text,
        type: r.object_slug,
        emails: r.email_addresses,
        domains: r.domains,
      })),
  },
];

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}

/** The tools the visitor's connections can back, each with its connection. */
export function availableTools(connections: Connection[]) {
  return TOOLS.flatMap((tool) => {
    const connection = connections.find((c) => c.platform === tool.platform);
    return connection ? [{ tool, connection }] : [];
  });
}

/** The exact `agent.think.functions` Deepgram receives. */
export function deepgramFunctions(tools: Tool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    ...(t.deferUntilEot ? { defer_until_eot: true } : {}),
  }));
}
