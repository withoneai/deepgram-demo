import "server-only";
import { allowedBy, capJson, type GeneralReceipt } from "../../catalog";
import type { Connection, OneBackend } from "../../one";
import { searchPeople } from "./attio-search-people";
import { draftEmail } from "./gmail-create-draft";
import type { CustomTool } from "./types";

/** Every custom tool. Add yours here. */
export const CUSTOM_TOOLS: CustomTool[] = [searchPeople, draftEmail];

const byName = new Map(CUSTOM_TOOLS.map((t) => [t.name, t]));

const usable = (tool: CustomTool, connections: Connection[]) => {
  const c = connections.find((x) => x.platform === tool.platform);
  return Boolean(c && allowedBy(c.access, { _id: tool.action.id, method: tool.action.method }));
};

/** The tools this user can use: their platform is connected and their access allows the action. */
export function customToolsFor(connections: Connection[]) {
  return CUSTOM_TOOLS.filter((t) => usable(t, connections));
}

/** What Deepgram gets in agent.think.functions. */
export function customToolDefinitions(connections: Connection[]) {
  return customToolsFor(connections).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

export const isCustomTool = (name: string) => byName.has(name);

/** Runs a custom tool under the user's grant. Same receipt as run_action, so the UI treats both alike. */
export async function runCustomTool(name: string, args: Record<string, any>, backend: OneBackend, connections: Connection[]): Promise<GeneralReceipt> {
  const tool = byName.get(name)!;
  const connection = connections.find((c) => c.platform === tool.platform);
  const base = { platform: tool.platform, actionTitle: tool.action.title, actionId: tool.action.id, method: tool.action.method, path: tool.action.path, blockedByGrant: false };
  if (!connection) return { ...base, ok: false, status: 0, content: { error: `${tool.platform} is not connected.` } };
  if (tool.changesSomething && args.confirmed !== true) {
    return { ...base, ok: false, status: 0, content: { error: "needs_confirmation", message: "This changes something. Say back in one short sentence what you are about to do, wait for a yes, then call it again with confirmed: true." } };
  }

  const { pathParams = {}, query, body } = tool.request(args);
  const path = tool.action.path.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => encodeURIComponent(pathParams[k] ?? ""));
  const result = await backend.runAction({
    connectionKey: connection.key,
    actionId: tool.action.id,
    method: tool.action.method,
    path,
    query,
    body: tool.action.servedByOne ? { ...(body as object), connectionKey: connection.key } : body,
  });
  const blocked = result.blockedByGrant || (result.status === 403 && !usable(tool, connections));
  return {
    ...base,
    path,
    ok: result.ok,
    status: result.status,
    blockedByGrant: blocked,
    content: blocked
      ? { error: "blocked_by_grant", message: `The user's access does not allow this on ${tool.platform}.` }
      : result.ok
        ? capJson(tool.result(result.data))
        : { error: `HTTP ${result.status}`, detail: capJson(result.data) },
  };
}
