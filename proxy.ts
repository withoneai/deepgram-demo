import { NextResponse, type NextRequest } from "next/server";
import { connectConfigured, refreshAhead } from "@/lib/one-connect";
import { SID_COOKIE, cookieOptions, newSid, readSessionCookie, sessionCookieWrites, unseal, withSession } from "@/lib/session";

// Next.js 16: src/proxy.ts (Node runtime by default).
// Next.js 15: name it middleware.ts, export `middleware`, and add
//   export const config = { runtime: "nodejs", matcher: [...] }  (15.5+)
//
// Runs before every page and route:
// 1. make sure the browser has an id, 2. rotate the One pair if it expires
// within ten minutes, 3. write the new cookie on the REQUEST (so this
// request's route sees it) and on the RESPONSE (so the browser keeps it).
export async function proxy(request: NextRequest) {
  const secure = request.nextUrl.protocol === "https:";
  const existing = request.cookies.get(SID_COOKIE)?.value;
  const uid = existing ?? newSid();

  let writes: ReturnType<typeof sessionCookieWrites> = [];
  const raw = connectConfigured() ? readSessionCookie(request.cookies) : undefined;
  if (raw) {
    const tokens = unseal(raw, uid);
    const r = await withSession(uid, tokens, async () => (tokens ? refreshAhead() : undefined));
    if (r.dirty || !tokens) writes = sessionCookieWrites(uid, r.tokens, request.cookies); // rotated, revoked or unreadable
  }

  for (const w of writes) {
    if (w.maxAge === 0) request.cookies.delete(w.name);
    else request.cookies.set(w.name, w.value);
  }
  if (!existing) request.cookies.set(SID_COOKIE, uid);

  const response = NextResponse.next({ request });
  for (const w of writes) response.cookies.set({ name: w.name, value: w.value, maxAge: w.maxAge, ...cookieOptions(secure) });
  if (!existing) response.cookies.set({ name: SID_COOKIE, value: uid, maxAge: 60 * 60 * 24 * 365, ...cookieOptions(secure) });
  return response;
}

export const config = {
  // Skip static files: they never need a session, and the proxy costs a unseal.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pcm-worklet.js|.*\\.(?:svg|png|jpg|jpeg|webp|gif|mp4|webm)$).*)"],
};
