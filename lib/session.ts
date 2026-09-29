import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

// One Connect session in a sealed, httpOnly cookie, refreshed ahead of expiry by the proxy.
// Copy this file as is; change COOKIE_PREFIX to your app's name.
//
//   <prefix>_session   { uid, accessToken, refreshToken, expiresAt }, AES-256-GCM
//                      sealed with a key derived from ONE_CLIENT_SECRET
//   <prefix>_sid       random per-browser id, used as the user id when the app
//                      has no login of its own (replace with your real user id
//                      if it has one)
//
// Only the proxy writes the session cookie (after a refresh), plus the OAuth
// callback and disconnect routes. Everything else reads it.

export const COOKIE_PREFIX = "dgva";
export const SESSION_COOKIE = `${COOKIE_PREFIX}_session`;
export const SID_COOKIE = `${COOKIE_PREFIX}_sid`;
const MAX_COOKIE = 3800; // browsers cap a cookie at 4096 bytes; chunk above this

export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
type Sealed = Tokens & { uid: string };
type Store = { uid: string; tokens: Tokens | null; dirty: boolean };

const als = new AsyncLocalStorage<Store>();

function key(): Buffer {
  // ONE_TOKEN_KEY, when set, lets you rotate the client secret without
  // signing everyone out. Otherwise the key derives from the client secret.
  const secret = process.env.ONE_TOKEN_KEY || process.env.ONE_CLIENT_SECRET;
  if (!secret) throw new Error("Set ONE_TOKEN_KEY or ONE_CLIENT_SECRET to seal tokens");
  // Domain-separated so the same secret never doubles as some other key.
  return createHash("sha256").update(`${COOKIE_PREFIX}/one-session/v1/${secret}`).digest();
}

export function seal(uid: string, tokens: Tokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ uid, ...tokens } satisfies Sealed), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Null when missing, tampered, sealed with an old secret, or sealed for another user. */
export function unseal(value: string | undefined, uid: string): Tokens | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const s = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Sealed;
    if (s.uid !== uid) return null; // someone else signed in on this browser
    return { accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt };
  } catch {
    return null;
  }
}

type CookieReader = { get(name: string): { value: string } | undefined; getAll(): { name: string; value: string }[] };

export function readSessionCookie(cookies: CookieReader): string | undefined {
  const whole = cookies.get(SESSION_COOKIE)?.value;
  if (whole) return whole;
  const chunks = cookies
    .getAll()
    .filter((c) => c.name.startsWith(`${SESSION_COOKIE}.`))
    .sort((a, b) => Number(a.name.split(".")[1]) - Number(b.name.split(".")[1]));
  return chunks.length ? chunks.map((c) => c.value).join("") : undefined;
}

export type CookieWrite = { name: string; value: string; maxAge: number };

/** The writes for a session (chunked if large), deleting stale chunks. Null tokens = sign out. */
export function sessionCookieWrites(uid: string, tokens: Tokens | null, existing: CookieReader): CookieWrite[] {
  const stale = existing.getAll().filter((c) => c.name === SESSION_COOKIE || c.name.startsWith(`${SESSION_COOKIE}.`));
  const deletes: CookieWrite[] = stale.map((c) => ({ name: c.name, value: "", maxAge: 0 }));
  if (!tokens) return deletes;
  const value = seal(uid, tokens);
  const maxAge = 60 * 60 * 24 * 30; // One's refresh token lives 30 days, sliding
  const parts = value.length <= MAX_COOKIE ? [value] : value.match(new RegExp(`.{1,${MAX_COOKIE}}`, "g"))!;
  const names = parts.length === 1 ? [SESSION_COOKIE] : parts.map((_, i) => `${SESSION_COOKIE}.${i}`);
  return [...deletes.filter((d) => !names.includes(d.name)), ...names.map((name, i) => ({ name, value: parts[i], maxAge }))];
}

export function cookieOptions(secure: boolean) {
  // Lax, not Strict: the OAuth callback is a top-level redirect from One and
  // must carry the cookie. Secure only on https, or localhost breaks.
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
}

export function serializeCookie(w: CookieWrite, secure: boolean): string {
  return [`${w.name}=${w.value}`, "Path=/", `Max-Age=${w.maxAge}`, "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}

export const newSid = () => randomUUID();

/** Runs `fn` with this request's session in scope for the Connect token store. */
export async function withSession<T>(uid: string, tokens: Tokens | null, fn: () => Promise<T>) {
  const store: Store = { uid, tokens, dirty: false };
  const result = await als.run(store, fn);
  return { result, tokens: store.tokens, dirty: store.dirty };
}

export const currentUid = () => als.getStore()?.uid ?? null;

// Pass this as `tokenStore` to createOneConnect(). It reads and writes the
// request-scoped session; the caller turns `dirty` into Set-Cookie headers.
export const cookieTokenStore = {
  saveTokens: async (userId: string, tokens: Tokens) => {
    const s = als.getStore();
    if (!s || s.uid !== userId) throw new Error("No session in scope to save tokens to");
    if (s.tokens && s.tokens.refreshToken !== tokens.refreshToken) remember(s.tokens.refreshToken, tokens);
    s.tokens = tokens;
    s.dirty = true;
  },
  loadTokens: async (userId: string): Promise<Tokens | null> => {
    const s = als.getStore();
    if (!s || s.uid !== userId || !s.tokens) return null;
    return rotated(s.tokens.refreshToken) ?? s.tokens;
  },
  clearTokens: async (userId: string) => {
    const s = als.getStore();
    if (!s || s.uid !== userId) return;
    s.tokens = null;
    s.dirty = true;
  },
};

// One revokes a refresh token the moment it is used (no grace period). Two
// tabs refreshing together would otherwise log the user out. Keep old -> new
// for a few minutes so a request holding the just-rotated token gets the new
// pair. In-memory: fine for one server; on serverless it is best effort (see
// SKILL.md "Serverless and many instances" for the database version).
const REUSE_WINDOW_MS = 5 * 60_000;
const rotations = new Map<string, { tokens: Tokens; at: number }>();
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function remember(oldRefresh: string, next: Tokens) {
  const now = Date.now();
  for (const [k, v] of rotations) if (now - v.at > REUSE_WINDOW_MS) rotations.delete(k);
  rotations.set(hash(oldRefresh), { tokens: next, at: now });
}

function rotated(refresh: string): Tokens | null {
  const hit = rotations.get(hash(refresh));
  if (!hit || Date.now() - hit.at > REUSE_WINDOW_MS) return null;
  return rotated(hit.tokens.refreshToken) ?? hit.tokens;
}

/** Refresh this far ahead of expiry, in the proxy, so no route ever has to. */
export const REFRESH_AHEAD_MS = 10 * 60_000;
