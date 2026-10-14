import "server-only";
import type { Access, ActionKnowledge, CatalogAction, Connection, FindAnswer, OneBackend } from "./one";
export { GENERAL_TOOL_NAMES } from "./tools/one-tools";

/**
 * The agent's only tools: any action in any app the user granted. The same loop as One's CLI and MCP server,
 * shortened for voice:
 *
 *   find_actions        One picks the action for each intent AND returns its
 *                       docs, several intents in one call (`one actions find`).
 *   get_action_details  Docs for a runner-up the find did not document.
 *   run_action          Runs it under the user's grant. Writes need a spoken yes.
 *
 * When One's picker refuses the call, find_actions falls back to ranking the
 * platform's catalog here and reading the top hit's docs.
 */

/** Sent with every find: what the agent is for, in general terms, so One can tell similar actions apart. */
const TASK = "answer or carry out a spoken request in the user's connected apps";

// ------------------------------------------------------------------ caches

const catalogCache = new Map<string, { at: number; actions: CatalogAction[] }>();
const CATALOG_TTL = 10 * 60_000;

async function catalog(backend: OneBackend, platform: string) {
  const hit = catalogCache.get(platform);
  if (hit && Date.now() - hit.at < CATALOG_TTL) return hit.actions;
  const actions = await backend.listActions(platform);
  catalogCache.set(platform, { at: Date.now(), actions });
  return actions;
}

/** Docs by action id. Docs are the same for every user, so one cache serves all. */
const docsCache = new Map<string, { at: number; doc: Promise<ActionKnowledge | null> }>();
const DOCS_TTL = 60 * 60_000;

function docs(backend: OneBackend, actionId: string, platform?: string, seed?: ActionKnowledge) {
  const hit = docsCache.get(actionId);
  if (hit && Date.now() - hit.at < DOCS_TTL) return hit.doc;
  const doc = seed ? Promise.resolve(seed) : backend.getKnowledge(actionId).catch(() => null);
  docsCache.set(actionId, { at: Date.now(), doc: doc.then((d) => (d && platform && !d.platform ? { ...d, platform } : d)) });
  return docsCache.get(actionId)!.doc;
}

// ------------------------------------------------------------- local search

const STOP = new Set(["a", "an", "the", "my", "me", "to", "for", "of", "in", "on", "and", "or", "with", "from", "all", "some", "i", "please"]);
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);

/** The fallback when One's picker is unavailable: keyword ranking over the catalog. */
function rank(actions: CatalogAction[], query: string, access?: Access) {
  const q = words(query);
  return actions
    .map((a) => {
      const title = new Set(words(a.title));
      const path = a.path.toLowerCase();
      let score = 0;
      for (const w of q) {
        if (title.has(w)) score += 3;
        else if ([...title].some((t) => t.startsWith(w) || w.startsWith(t))) score += 1.5;
        if (path.includes(w)) score += 1;
      }
      // With a restricted grant, an allowed action beats a slightly better-named one.
      const allowedBonus = access && access.policy !== "full" && score > 0 && allowedBy(access, a) ? 2 : 0;
      return { a, score: score / Math.sqrt(title.size + 1) + allowedBonus };
    })
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 6)
    .map((r) => r.a);
}

async function findLocally(backend: OneBackend, requests: { platform: string; intent: string }[]): Promise<FindAnswer[]> {
  return Promise.all(
    requests.map(async ({ platform, intent }) => {
      const [best, ...rest] = rank(await catalog(backend, platform), intent);
      const doc = best ? await docs(backend, best._id, platform) : null;
      return { platform, intent, selected: best && doc ? [{ ...best, knowledge: doc.knowledge }] : [], alternatives: rest };
    }),
  );
}

// ------------------------------------------------------------------ helpers

export function allowedBy(access: Access, action: { _id: string; method: string }) {
  if (access.policy === "full") return true;
  if (access.policy === "methods") return access.methods.includes(action.method.toUpperCase());
  return access.actions.some((x) => x.actionId === action._id);
}

/**
 * Whether running this changes something. Not just the method: Notion search,
 * Attio queries and GraphQL reads are POSTs, and asking "shall I?" before a
 * search would make the agent unbearable on a call.
 */
export function isWrite(action: { title: string; method: string; path: string }) {
  if (action.method.toUpperCase() === "GET") return false;
  if (/^(search|list|get|retrieve|query|find|read|check|fetch|look|view|count)\b/i.test(action.title.trim())) return false;
  return !/\/(search|query)(\/|$)/i.test(action.path);
}

/** The request-building parts of an action's docs: no response samples, examples, or CLI notices. */
function trimKnowledge(md: string) {
  const kept = md
    .replace(/^> \*\*Digest\.\*\*.*\n+/m, "")
    .split(/\n(?=#{1,3} )/)
    .filter((section) => !/^#{1,3} .*(response|example|sample|curl|omitted|load more|behavior|notes|error|prerequisite)/i.test(section.trim()))
    .join("\n")
    .trim();
  return kept.length > 3500 ? `${kept.slice(0, 3500)}\n…(truncated)` : kept;
}

/** Fields no spoken answer needs: sync tokens, links, images, conference blobs. */
const NOISE = /^(etag|kind|nextSyncToken|sequence|iCalUID|conferenceData|hangoutLink|reminders|eventType|_links|links|href|.*_url|.*Url|url|avatar.*|image.*|icon.*|thumbnail.*|object|request_id|has_more|next_cursor)$/i;

/** Shrinks a provider payload to something a voice turn can use. */
function shrink(value: unknown, limits: { str: number; items: number }, depth = 0): unknown {
  if (typeof value === "string") return value.length > limits.str ? `${value.slice(0, limits.str)}…` : value;
  if (Array.isArray(value)) {
    const items = value.slice(0, limits.items).map((v) => shrink(v, limits, depth + 1));
    return value.length > limits.items ? [...items, `…${value.length - limits.items} more`] : items;
  }
  if (value && typeof value === "object") {
    if (depth > 5) return "{…}";
    const entries = Object.entries(value).filter(([k, v]) => !NOISE.test(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length));
    return Object.fromEntries(entries.slice(0, 25).map(([k, v]) => [k, shrink(v, limits, depth + 1)]));
  }
  return value;
}

/** Tighter and tighter until it fits, so the model always gets valid JSON, never a cut-off string. */
export function capJson(value: unknown) {
  for (const limits of [{ str: 280, items: 8 }, { str: 160, items: 5 }, { str: 100, items: 3 }]) {
    const shrunk = shrink(value, limits);
    if (JSON.stringify(shrunk).length <= 5000) return shrunk;
  }
  return { truncated: true, partial: JSON.stringify(shrink(value, { str: 80, items: 3 })).slice(0, 5000) };
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

// --------------------------------------------------------------------- run

export type GeneralReceipt = {
  platform: string;
  actionTitle: string;
  actionId: string;
  method: string;
  path: string;
  ok: boolean;
  status: number;
  blockedByGrant: boolean;
  content: unknown;
};

export async function runGeneralTool(name: string, args: Record<string, any>, backend: OneBackend, connections: Connection[]): Promise<GeneralReceipt> {
  const connectionFor = (platform: string) => connections.find((c) => c.platform === platform);

  if (name === "find_actions") {
    const requests: { platform: string; intent: string }[] = (Array.isArray(args.requests) ? args.requests : [args])
      .map((r: any) => ({ platform: String(r?.platform ?? ""), intent: String(r?.intent ?? r?.query ?? "").trim() }))
      .filter((r: { intent: string }) => r.intent)
      .slice(0, 5);
    const platforms = [...new Set(requests.map((r) => r.platform))];
    const base = { platform: platforms.length === 1 ? platforms[0] : "", actionTitle: requests.map((r) => r.intent).join(", "), actionId: "", method: "FIND", path: "", blockedByGrant: false };
    const reachable = requests.filter((r) => connectionFor(r.platform));
    if (!reachable.length) return { ...base, ok: false, status: 0, content: { error: `Not connected: ${platforms.join(", ") || "no app named"}.` } };

    const picked = await backend.findActions(reachable, TASK).catch(() => null);
    if (!picked) console.warn(`[find_actions] One's picker refused (${backend.mode} mode); ranking the catalog locally`);
    const answers = picked ?? (await findLocally(backend, reachable));
    return {
      ...base,
      ok: true,
      status: 200,
      content: requests.map((r) => {
        const connection = connectionFor(r.platform);
        if (!connection) return { platform: r.platform, intent: r.intent, error: `${r.platform} is not connected.` };
        const answer = answers[reachable.indexOf(r)];
        const [best] = answer?.selected ?? [];
        if (!best) return { platform: r.platform, intent: r.intent, none: "No matching action. Try other words." };
        // Remember the docs so get_action_details and run_action never refetch them.
        docs(backend, best._id, r.platform, { ...best, tags: best.tags ?? [], platform: r.platform });
        return {
          platform: r.platform,
          intent: r.intent,
          action_id: best._id,
          title: best.title,
          method: best.method,
          path: best.path,
          allowed_by_grant: allowedBy(connection.access, best),
          changes_something: isWrite(best),
          docs: trimKnowledge(best.knowledge),
          alternatives: (answer?.alternatives ?? []).slice(0, 4).map((a) => ({ action_id: a._id, title: a.title, allowed_by_grant: allowedBy(connection.access, a) })),
        };
      }),
    };
  }

  if (name === "get_action_details") {
    const k = await docs(backend, String(args.action_id ?? ""));
    if (!k) return { platform: "", actionTitle: "Read action docs", actionId: String(args.action_id), method: "DOCS", path: "", ok: false, status: 404, blockedByGrant: false, content: { error: "Unknown action id." } };
    return {
      platform: k.platform,
      actionTitle: `Docs: ${k.title}`,
      actionId: k._id,
      method: "DOCS",
      path: k.path,
      ok: true,
      status: 200,
      blockedByGrant: false,
      content: { title: k.title, method: k.method, path: k.path, changes_something: isWrite(k), docs: trimKnowledge(k.knowledge) },
    };
  }

  // run_action
  const platform = String(args.platform ?? "");
  const connection = connectionFor(platform);
  const action = await docs(backend, String(args.action_id ?? ""), platform);
  const failed = (actionTitle: string, error: string, extra: Partial<GeneralReceipt> = {}): GeneralReceipt => ({ platform, actionTitle, actionId: String(args.action_id), method: action?.method ?? "?", path: action?.path ?? "", ok: false, status: 0, blockedByGrant: false, content: { error }, ...extra });
  if (!connection) return failed("Run action", `${platform} is not connected.`);
  if (!action) return failed("Run action", "Unknown action id. Use one find_actions returned in this conversation.");
  if (action.platform && action.platform !== platform) return failed(action.title, `That action belongs to ${action.platform}, not ${platform}.`);

  if (isWrite(action) && args.confirmed !== true) {
    return failed(action.title, "needs_confirmation", {
      content: { error: "needs_confirmation", message: "This changes something. Say back in one short sentence what you are about to do, wait for a yes, then call run_action again with confirmed: true." },
    });
  }

  // "me" is the conventional self id (Gmail, Microsoft Graph, ...); models often omit it.
  const pathParams: Record<string, unknown> = { userId: "me", ...(args.path_params ?? {}) };
  const missing = [...action.path.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((key) => pathParams[key] === undefined || pathParams[key] === "");
  if (missing.length) return failed(action.title, `Missing path_params: ${missing.join(", ")}. Get them with another action (usually a list or search), then run this again.`);

  const path = action.path.replace(PLACEHOLDER, (_, key) => encodeURIComponent(String(pathParams[key] ?? "")));
  const query = Object.fromEntries(Object.entries(args.query_params ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const body = args.body && Object.keys(args.body).length ? args.body : undefined;
  // Actions One serves itself ("custom") read the connection key from the body, as the CLI sends it.
  const custom = action.tags?.includes("custom") && action.method.toUpperCase() !== "GET";
  const result = await backend.runAction({
    connectionKey: connection.key,
    actionId: action._id,
    method: action.method,
    path,
    query: Object.keys(query).length ? query : undefined,
    body: custom ? { ...(body ?? {}), connectionKey: connection.key } : body,
  });
  // One's grant refusal is sometimes a bare "403 Forbidden" with no correlationId,
  // so a 403 on an action outside the grant counts as the grant working.
  const blocked = result.blockedByGrant || (result.status === 403 && !allowedBy(connection.access, action));
  return {
    platform,
    actionTitle: action.title,
    actionId: action._id,
    method: action.method,
    path,
    ok: result.ok,
    status: result.status,
    blockedByGrant: blocked,
    content: blocked
      ? { error: "blocked_by_grant", message: `The user's access does not allow this ${action.method} on ${platform}. It never reached ${platform}.` }
      : result.ok
        ? capJson(result.data)
        : { error: `HTTP ${result.status}`, detail: capJson(result.data) },
  };
}
