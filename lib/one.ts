import "server-only";
import { connectConfigured, oneConnect, uid } from "./one-connect";

/**
 * Two ways to reach One, same shape to the rest of the app:
 *
 *  - "connect": the embed pitch. The visitor clicks Connect, grants this
 *    app scoped access to tools in THEIR One account, and every tool call
 *    runs under that grant. One refuses anything outside it.
 *  - "key": no Connect app configured. Runs on your own One secret
 *    (ONE_SECRET) and the first connection of each platform in your account,
 *    so you can try the voice loop before setting up Connect.
 */

const ONE_API = "https://api.withone.ai/v1";

export type Access =
  | { policy: "full" }
  | { policy: "methods"; methods: string[] }
  | { policy: "actions"; actions: { actionId: string; title: string; method: string }[] };

export type Connection = { key: string; platform: string; title?: string; access: Access };

export type ActionCall = {
  connectionKey: string;
  actionId: string;
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

export type ActionResult = { status: number; ok: boolean; blockedByGrant: boolean; data: unknown };

export type CatalogAction = { _id: string; title: string; method: string; path: string };

export interface OneBackend {
  mode: "connect" | "key";
  isConnected(): Promise<boolean>;
  listConnections(): Promise<Connection[]>;
  runAction(call: ActionCall): Promise<ActionResult>;
  /** Every catalog action for a platform: what exists, not what the grant allows. */
  listActions(platform: string): Promise<CatalogAction[]>;
  /** The action's markdown docs (parameters, rules), or null. */
  getKnowledge(actionId: string): Promise<ActionKnowledge | null>;
  /** Who is connected, or null when One will not say. */
  getUser(): Promise<OneUser | null>;
}

export type OneUser = { name?: string; email?: string };

async function userFrom(response: Response): Promise<OneUser | null> {
  if (!response.ok) return null;
  const body = await response.json();
  const u = body?.user ?? body;
  // whoami returns { user: { name, email } }; /users/me returns { email, firstName, lastName }.
  const name = u?.name ?? ([u?.firstName, u?.lastName].filter(Boolean).join(" ") || undefined);
  return u?.email || name ? { name, email: u.email ?? undefined } : null;
}

export type ActionKnowledge = CatalogAction & { platform: string; knowledge: string };

async function knowledgeFrom(response: Response): Promise<ActionKnowledge | null> {
  if (!response.ok) return null;
  const row = (await response.json())?.rows?.[0];
  if (!row?.knowledge) return null;
  return { _id: String(row._id), title: String(row.title), method: String(row.method), path: String(row.path), platform: String(row.connectionPlatform), knowledge: String(row.knowledge) };
}


// ---------------------------------------------------------------- connect

const connectBackend: OneBackend = {
  mode: "connect",
  isConnected: () => oneConnect().isConnected(uid()),
  listConnections: async () => {
    if (!(await oneConnect().isConnected(uid()))) return [];
    const rows = await oneConnect().listConnections(uid());
    return rows.map((r) => ({ key: r.key, platform: r.platform, title: r.title ?? r.name, access: r.access }));
  },
  runAction: (call) => oneConnect().runAction(uid(), call),
  listActions: (platform) => oneConnect().listActions(uid(), platform),
  getKnowledge: async (actionId) => knowledgeFrom(await oneConnect().fetch(uid(), `/knowledge?_id=${encodeURIComponent(actionId)}`)),
  // Needs the user:profile:read scope (requested in ./one-connect.ts).
  getUser: async () => {
    if (!(await oneConnect().isConnected(uid()))) return null;
    return userFrom(await oneConnect().fetch(uid(), "/users/me"));
  },
};

// -------------------------------------------------------------------- dev

function oneSecret(): string {
  const secret = process.env.ONE_SECRET;
  if (!secret) throw new Error("Set ONE_SECRET, or configure a Connect app (ONE_CLIENT_ID, ONE_CLIENT_SECRET, ONE_REDIRECT_URI).");
  return secret;
}

let keyConnections: { at: number; rows: Connection[] } | null = null;

/** The first connection of each platform in the account, cached for a minute. */
async function devConnections(): Promise<Connection[]> {
  if (keyConnections && Date.now() - keyConnections.at < 60_000) return keyConnections.rows;
  const r = await devFetch("/vault/connections?limit=100");
  const rows: Connection[] = [];
  for (const c of r.ok ? ((await r.json()).rows ?? []) : []) {
    if (!rows.some((x) => x.platform === c.platform)) rows.push({ key: c.key, platform: c.platform, title: c.name ?? undefined, access: { policy: "full" } });
  }
  keyConnections = { at: Date.now(), rows };
  return rows;
}

async function devFetch(pathAndQuery: string) {
  return fetch(`${ONE_API}${pathAndQuery}`, { headers: { "x-one-secret": oneSecret() } });
}

const devBackend: OneBackend = {
  mode: "key",
  listActions: async (platform) => {
    const rows: CatalogAction[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await devFetch(`/knowledge?connectionPlatform=${encodeURIComponent(platform)}&limit=100&page=${page}`);
      if (!r.ok) break;
      const body = await r.json();
      rows.push(...(body.rows ?? []).map((x: any) => ({ _id: String(x._id), title: String(x.title), method: String(x.method), path: String(x.path) })));
      if (page >= (body.pages ?? 1)) break;
    }
    return rows;
  },
  getKnowledge: async (actionId) => knowledgeFrom(await devFetch(`/knowledge?_id=${encodeURIComponent(actionId)}`)),
  // /v1/users/me takes a dashboard session only; whoami takes an API key.
  getUser: async () => userFrom(await devFetch("/users/whoami")),
  isConnected: async () => (await devConnections()).length > 0,
  listConnections: () => devConnections(),
  runAction: async (call) => {
    const method = call.method.toUpperCase();
    const query = call.query ? `?${new URLSearchParams(call.query)}` : "";
    const hasBody = method !== "GET" && method !== "HEAD" && call.body !== undefined;
    const response = await fetch(`${ONE_API}/passthrough${call.path}${query}`, {
      method,
      headers: {
        "x-one-secret": oneSecret(),
        "x-one-connection-key": call.connectionKey,
        "x-one-action-id": call.actionId,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(call.body) : undefined,
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {}
    const blockedByGrant = !response.ok && typeof data === "object" && data !== null && "correlationId" in data;
    return { status: response.status, ok: response.ok, blockedByGrant, data };
  },
};

export function one(): OneBackend {
  return connectConfigured() ? connectBackend : devBackend;
}
