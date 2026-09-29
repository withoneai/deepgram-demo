import { createOneConnectRoutes } from "@withone/connect/next";
import { connectConfigured, oneConnect, requestSession } from "@/lib/one-connect";
import { serializeCookie, sessionCookieWrites, withSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/one/authorize  -> One's hosted consent page (state + PKCE handled by the package)
// GET /api/one/callback   -> code exchange; the new pair is sealed onto the redirect home
// Register exactly `${origin}/api/one/callback` as the app's redirect URI.
export async function GET(request: Request) {
  if (!connectConfigured()) {
    return Response.redirect(new URL("/?one_connect=error&one_connect_message=Connect+is+not+configured", request.url));
  }
  const { uid, tokens, jar } = await requestSession();
  const routes = createOneConnectRoutes(oneConnect(), { identifyUser: () => uid });
  const { result, dirty, tokens: next } = await withSession(uid, tokens, () => routes.GET(request));
  if (!dirty) return result;

  // Keep the package's own Set-Cookie headers (its PKCE flow cookie), add ours.
  const headers = new Headers(result.headers);
  const secure = new URL(request.url).protocol === "https:";
  for (const w of sessionCookieWrites(uid, next, jar)) headers.append("Set-Cookie", serializeCookie(w, secure));
  return new Response(result.body, { status: result.status, headers });
}
