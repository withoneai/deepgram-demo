import { inSession } from "@/lib/one-connect";
import { one } from "@/lib/one";
import { GENERAL_TOOL_NAMES, runGeneralTool } from "@/lib/catalog";
import { isCustomTool, runCustomTool } from "@/lib/tools/custom";

/** Runs one Deepgram function call (a custom tool, or find_actions / get_action_details / run_action) and returns a receipt. */
export async function POST(request: Request) {
  // Read-only session scope: the proxy already refreshed the tokens if needed.
  return inSession(() => handle(request));
}

async function handle(request: Request) {
  const { name, arguments: rawArgs, timeZone } = await request.json();
  let args: Record<string, any> = {};
  try {
    args = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : rawArgs ?? {};
  } catch {}

  const backend = one();
  // A revoked or expired grant is "not connected", not a server error.
  let connections: Awaited<ReturnType<typeof backend.listConnections>>;
  try {
    connections = await backend.listConnections();
  } catch {
    return Response.json({ tool: name, args, ok: false, status: 401, blockedByGrant: false, ms: 0, content: { error: "not_connected", message: "The user is not connected to One. Ask them to connect their apps again." } });
  }

  if (isCustomTool(name)) {
    const started = Date.now();
    const receipt = await runCustomTool(name, args, backend, connections);
    return Response.json({ tool: name, args, ...receipt, ms: Date.now() - started });
  }

  if ((GENERAL_TOOL_NAMES as readonly string[]).includes(name)) {
    const started = Date.now();
    const receipt = await runGeneralTool(name, args, backend, connections);
    return Response.json({ tool: name, args, ...receipt, ms: Date.now() - started });
  }

  return Response.json({ ok: false, content: { error: `Unknown tool ${name}` } }, { status: 400 });
}
