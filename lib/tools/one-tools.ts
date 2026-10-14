import type { Connection } from "../one";

/**
 * The three tools that give the agent every connected app. They mirror One's
 * own agent loop (the CLI's `one actions find / load / execute`, and the MCP
 * server's `find_one_actions` / `execute_one_action`):
 *
 *   find_actions        One picks the action for each intent and returns its docs.
 *   get_action_details  Docs for a runner-up the find did not document.
 *   run_action          Runs it under the user's grant. Writes need a spoken yes.
 *
 * These are only the definitions Deepgram sees. lib/catalog.ts runs them.
 */

export const GENERAL_TOOL_NAMES = ["find_actions", "get_action_details", "run_action"] as const;

const OBJECT = { type: "object", description: "Key/value pairs. Omit when the docs list none." };

export function generalToolDefinitions(connections: Connection[]) {
  const platforms = [...new Set(connections.map((c) => c.platform))];
  return [
    {
      name: "find_actions",
      description:
        "Find how to do something in the user's connected apps. Send every step the request needs in ONE call, e.g. [{platform:'linear', intent:'list teams'}, {platform:'linear', intent:'create an issue'}]. Returns, per step, the best action with its docs (parameters and rules) and whether the user's access allows it. Skip this for an action you already found in this conversation.",
      parameters: {
        type: "object",
        properties: {
          requests: {
            type: "array",
            description: "One entry per operation, up to 5.",
            items: {
              type: "object",
              properties: {
                platform: { type: "string", enum: platforms, description: "The connected app." },
                intent: { type: "string", description: "The operation alone, in a few words, without names or values: 'create an issue', not 'create an issue called Fix login'." },
              },
              required: ["platform", "intent"],
            },
          },
        },
        required: ["requests"],
      },
    },
    {
      name: "get_action_details",
      description: "Read the docs of an action find_actions listed as an alternative. The best match already comes with its docs.",
      parameters: {
        type: "object",
        properties: { action_id: { type: "string", description: "An action_id from find_actions." } },
        required: ["action_id"],
      },
    },
    {
      name: "run_action",
      description:
        "Run an action from find_actions under the user's access. Put {{placeholders}} from the path in path_params, URL query values in query_params, and only body fields in body. Anything that creates, changes, sends or deletes needs confirmed: true, which you may set only after the user said yes to your one-sentence summary.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: platforms },
          action_id: { type: "string" },
          path_params: { ...OBJECT, description: "Values for the {{placeholders}} in the action's path." },
          query_params: OBJECT,
          body: { ...OBJECT, description: "JSON body, for actions that take one." },
          confirmed: { type: "boolean", description: "True only after the user agreed to this exact change out loud." },
        },
        required: ["platform", "action_id"],
      },
    },
  ];
}
