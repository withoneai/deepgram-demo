import { createOneConnect } from "@withone/connect/server";
import { cookies } from "next/headers";
import { REFRESH_AHEAD_MS, SID_COOKIE, cookieTokenStore, currentUid, readSessionCookie, unseal, withSession } from "./session";

// The Connect client. Tokens live in the sealed cookie (./session.ts).

export const connectConfigured = () =>
  Boolean(process.env.ONE_CLIENT_ID && process.env.ONE_CLIENT_SECRET && process.env.ONE_REDIRECT_URI);

// The package's default scopes plus `user:profile:read`, so /v1/users/me can
// say who connected. Without it One answers 401 and the app just shows no name.
const SCOPES = [
  "user:connections:read",
  "user:connections:write",
  "org:connections:read",
  "org:connections:write",
  "project:connections:read",
  "project:connections:write",
  "user:profile:read",
];

let client: ReturnType<typeof createOneConnect> | undefined;

export function oneConnect() {
  client ??= createOneConnect({
    clientId: process.env.ONE_CLIENT_ID!,
    clientSecret: process.env.ONE_CLIENT_SECRET!,
    redirectUri: process.env.ONE_REDIRECT_URI!,
    permissionSet: process.env.ONE_PERMISSION_SET || undefined,
    scopes: SCOPES,
    tokenStore: cookieTokenStore,
  });
  return client;
}

/** The user id Connect keys the grant by: the session's uid. */
export function uid(): string {
  const u = currentUid();
  if (!u) throw new Error("No session in scope: wrap the call in inSession()");
  return u;
}

/**
 * Who the user is, for this request. This app has no login of its own, so it
 * is the per-browser sid cookie. An app with its own login returns its real
 * user id here and in the proxy.
 */
export async function requestSession() {
  const jar = await cookies();
  const id = jar.get(SID_COOKIE)?.value ?? "anonymous";
  const tokens = connectConfigured() ? unseal(readSessionCookie(jar), id) : null;
  return { uid: id, tokens, jar };
}

/** Read-only scope for pages and routes. The proxy already did any refresh. */
export async function inSession<T>(fn: () => Promise<T>): Promise<T> {
  const { uid: id, tokens } = await requestSession();
  return (await withSession(id, tokens, fn)).result;
}

/** Proxy only: rotate the pair if it expires soon. */
export async function refreshAhead(): Promise<void> {
  const c = oneConnect();
  const t = await c.getTokens(uid());
  if (t && t.expiresAt - Date.now() < REFRESH_AHEAD_MS) {
    try {
      await c.refreshTokens(uid());
    } catch {
      // refresh_failed: revoked or expired. The store was cleared; the proxy
      // writes a signed-out cookie and the UI shows the Connect button again.
    }
  }
}
