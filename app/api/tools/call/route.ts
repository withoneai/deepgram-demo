import { inSession } from "@/lib/one-connect";
import { one } from "@/lib/one";
import { toolByName } from "@/lib/tools";
import { allowedBy, GENERAL_TOOL_NAMES, runGeneralTool } from "@/lib/catalog";

/** Runs one Deepgram function call as a One action and returns a receipt. */
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

  if ((GENERAL_TOOL_NAMES as readonly string[]).includes(name)) {
    const started = Date.now();
    const receipt = await runGeneralTool(name, args, backend, connections);
    return Response.json({ tool: name, args, ...receipt, ms: Date.now() - started });
  }

  const tool = toolByName(name);
  if (!tool) return Response.json({ ok: false, content: { error: `Unknown tool ${name}` } }, { status: 400 });

  const connection = connections.find((c) => c.platform === tool.platform);
  const call = tool.build(args, { timeZone: timeZone || "America/Los_Angeles" });
  const receipt = {
    tool: tool.name,
    platform: tool.platform,
    actionTitle: tool.actionTitle,
    actionId: call.actionId,
    method: call.method,
    path: call.path,
    args,
  };

  if (!connection) {
    return Response.json({ ...receipt, ok: false, status: 0, blockedByGrant: false, ms: 0, content: { error: `No ${tool.platform} connection.` } });
  }

  const started = Date.now();
  const run = (c: typeof call) => backend.runAction({ ...c, connectionKey: connection.key });
  const raw = tool.compose ? await tool.compose(args, run) : await run(call);
  const result = { ...raw, blockedByGrant: raw.blockedByGrant || (raw.status === 403 && !allowedBy(connection.access, { _id: call.actionId, method: call.method })) };
  const ms = Date.now() - started;

  const content = result.blockedByGrant
    ? { error: "blocked_by_grant", message: `The user's One grant does not allow ${call.method} on ${tool.platform}. The request never reached ${tool.platform}.` }
    : result.ok
      ? tool.summarize(result.data)
      : { error: `HTTP ${result.status}`, detail: typeof result.data === "string" ? result.data.slice(0, 300) : result.data };

  return Response.json({ ...receipt, ok: result.ok, status: result.status, blockedByGrant: result.blockedByGrant, ms, content });
}
