import { connectConfigured, oneConnect, requestSession } from "@/lib/one-connect";
import { serializeCookie, sessionCookieWrites, withSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Drops this app's copy of the grant (the cookie). The grant itself stays in
// the user's One account until they revoke it there. POST only: a GET here
// could be triggered by any <img src> on another site.
export async function POST(request: Request) {
  const { uid, tokens, jar } = await requestSession();
  if (connectConfigured() && tokens) await withSession(uid, tokens, () => oneConnect().disconnect(uid));
  const headers = new Headers({ "Content-Type": "application/json" });
  const secure = new URL(request.url).protocol === "https:";
  for (const w of sessionCookieWrites(uid, null, jar)) headers.append("Set-Cookie", serializeCookie(w, secure));
  return new Response(JSON.stringify({ ok: true }), { headers });
}
