/**
 * A custom tool: one fixed One action behind a name, a description and a
 * parameter schema written for the model. Nothing to find, nothing to read:
 * the model calls it in one step, so it is the fast path for the things a
 * voice agent does all day.
 *
 * Copy one of the files next to this one, change the action and the
 * mapping, and add it to the list in ./index.ts. It only shows up for a user
 * who connected that platform and whose access allows the action.
 */
export type CustomTool = {
  /** The function name Deepgram sees, e.g. "search_people". */
  name: string;
  /** The One platform the action belongs to, e.g. "attio". */
  platform: string;
  /** Written for the model: when to use it, in one or two sentences. */
  description: string;
  /** JSON Schema for the arguments the model fills in. */
  parameters: Record<string, unknown>;
  /** The One action this tool runs. Find ids with `one actions find <platform> "<intent>"`. */
  action: {
    id: string;
    title: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    /** Actions One serves itself (paths under /v1/<platform>/...) take the connection key in the body. */
    servedByOne?: boolean;
  };
  /** True when running it creates, changes, sends or deletes. The model then needs the user's yes first. */
  changesSomething: boolean;
  /** The model's arguments -> the action's request. */
  request: (args: Record<string, any>) => { pathParams?: Record<string, string>; query?: Record<string, string>; body?: unknown };
  /** The provider's response -> only what a spoken answer needs. */
  result: (data: any) => unknown;
};
