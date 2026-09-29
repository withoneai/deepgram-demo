import "server-only";
import type { Access, CatalogAction, Connection, OneBackend } from "./one";

/**
 * The general tools: the agent can reach any action in any app the user
 * granted, not just the hand-written shortcuts. Same three steps as One's
 * MCP server and CLI: find an action, read its docs, run it.
 *
 * Search ranks the platform's catalog locally. One's hosted search endpoint
 * does not accept Connect tokens today, but the catalog listing does.
 */

export const GENERAL_TOOL_NAMES = ["find_actions", "get_action_details", "run_action"] as const;

const catalogCache = new Map<string, { at: number; actions: CatalogAction[] }>();
const CATALOG_TTL = 10 * 60_000;

async function catalog(backend: OneBackend, platform: string) {
  const hit = catalogCache.get(platform);
  if (hit && Date.now() - hit.at < CATALOG_TTL) return hit.actions;
  const actions = await backend.listActions(platform);
  catalogCache.set(platform, { at: Date.now(), actions });
  return actions;
}

const STOP = new Set(["a", "an", "the", "my", "me", "to", "for", "of", "in", "on", "and", "or", "with", "from", "all", "some", "i", "please"]);
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);

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

export function allowedBy(access: Access, action: { _id: string; method: string }) {
  if (access.policy === "full") return true;
  if (access.policy === "methods") return access.methods.includes(action.method.toUpperCase());
  return access.actions.some((x) => x.actionId === action._id);
}

/** Keeps what the model needs to call the action: drops response samples and long examples. */
function trimKnowledge(md: string) {
  const kept = md
    .split(/\n(?=#{1,3} )/)
    .filter((section) => !/^#{1,3} .*(response|example|sample|error|behavior|notes|curl)/i.test(section.trim()))
    .join("\n");
  return kept.length > 3500 ? `${kept.slice(0, 3500)}\n…(truncated)` : kept;
}

/** Shrinks a provider payload to something a voice turn can use. */
function shrink(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 280 ? `${value.slice(0, 280)}…` : value;
  if (Array.isArray(value)) {
    const items = value.slice(0, 8).map((v) => shrink(v, depth + 1));
    return value.length > 8 ? [...items, `…${value.length - 8} more`] : items;
  }
  if (value && typeof value === "object") {
    if (depth > 5) return "{…}";
    return Object.fromEntries(Object.entries(value).slice(0, 25).map(([k, v]) => [k, shrink(v, depth + 1)]));
  }
  return value;
}

function capJson(value: unknown) {
  const text = JSON.stringify(shrink(value));
  return text.length > 5000 ? { truncated: true, partial: text.slice(0, 5000) } : JSON.parse(text);
}

const OBJECT = { type: "object", description: "Key/value pairs. Omit when the docs list none." };

export function generalToolDefinitions(connections: Connection[]) {
  const platforms = connections.map((c) => c.platform);
  return [
    {
      name: "find_actions",
      description:
        "Search the API actions available in one of the user's connected apps. Use for anything the shortcut tools do not cover. Returns action ids, titles, and whether the user's grant allows each one.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: platforms, description: "Which connected app to search." },
          query: { type: "string", description: "What you want to do, in a few words, e.g. 'list unread emails' or 'search pages'." },
        },
        required: ["platform", "query"],
      },
    },
    {
      name: "get_action_details",
      description: "Read an action's docs: its path parameters, query parameters and body fields. Call before run_action unless the parameters are obvious.",
      parameters: {
        type: "object",
        properties: { action_id: { type: "string", description: "An id returned by find_actions." } },
        required: ["action_id"],
      },
    },
    {
      name: "run_action",
      description: "Run an action through One with the user's grant. Pass parameters exactly as the docs describe.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: platforms },
          action_id: { type: "string" },
          path_params: { ...OBJECT, description: "Values for {{placeholders}} in the action's path." },
          query_params: OBJECT,
          body: { ...OBJECT, description: "JSON body for POST, PUT and PATCH actions." },
        },
        required: ["platform", "action_id"],
      },
    },
  ];
}

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
    const platform = String(args.platform ?? "");
    const connection = connectionFor(platform);
    const base = { platform, actionTitle: `Search ${platform} actions`, actionId: "", method: "FIND", path: `"${args.query ?? ""}"`, blockedByGrant: false };
    if (!connection) return { ...base, ok: false, status: 0, content: { error: `${platform} is not connected.` } };
    const found = rank(await catalog(backend, platform), String(args.query ?? ""), connection.access);
    return {
      ...base,
      ok: true,
      status: 200,
      content: found.length
        ? found.map((a) => ({ action_id: a._id, title: a.title, method: a.method, path: a.path, allowed_by_grant: allowedBy(connection.access, a) }))
        : { none: "No matching actions. Try different words." },
    };
  }

  if (name === "get_action_details") {
    const k = await backend.getKnowledge(String(args.action_id ?? ""));
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
      content: { title: k.title, method: k.method, path: k.path, docs: trimKnowledge(k.knowledge) },
    };
  }

  // run_action
  const platform = String(args.platform ?? "");
  const connection = connectionFor(platform);
  const action = (await catalog(backend, platform)).find((a) => a._id === args.action_id);
  if (!connection || !action) {
    return { platform, actionTitle: "Run action", actionId: String(args.action_id), method: "?", path: "", ok: false, status: 0, blockedByGrant: false, content: { error: !connection ? `${platform} is not connected.` : "Unknown action id for this platform. Use find_actions first." } };
  }
  // "me" is the conventional self id (Gmail, Microsoft Graph, ...); models often omit it.
  const pathParams: Record<string, unknown> = { userId: "me", ...(args.path_params ?? {}) };
  const missing = [...action.path.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]).filter((key) => pathParams[key] === undefined || pathParams[key] === "");
  if (missing.length) {
    return { platform, actionTitle: action.title, actionId: action._id, method: action.method, path: action.path, ok: false, status: 0, blockedByGrant: false, content: { error: `Missing path_params: ${missing.join(", ")}. Call get_action_details to see what they are, then run_action again.` } };
  }
  const path = action.path.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => encodeURIComponent(String(pathParams[key] ?? "")));
  const query = Object.fromEntries(Object.entries(args.query_params ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const result = await backend.runAction({
    connectionKey: connection.key,
    actionId: action._id,
    method: action.method,
    path,
    query: Object.keys(query).length ? query : undefined,
    body: args.body && Object.keys(args.body).length ? args.body : undefined,
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
      ? { error: "blocked_by_grant", message: `The user's One grant does not allow this ${action.method} on ${platform}. It never reached ${platform}.` }
      : result.ok
        ? capJson(result.data)
        : { error: `HTTP ${result.status}`, detail: capJson(result.data) },
  };
}
