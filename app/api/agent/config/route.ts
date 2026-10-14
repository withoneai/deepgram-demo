import { inSession } from "@/lib/one-connect";
import { one } from "@/lib/one";
import type { Access, Connection } from "@/lib/one";
import { generalToolDefinitions } from "@/lib/tools/one-tools";
import { customToolDefinitions, customToolsFor } from "@/lib/tools/custom";
import { THINK_MODELS, resolveModel } from "@/lib/models";
import { workspaceKeyterms } from "@/lib/vocab";
import { platformName } from "@/lib/platforms";

/** Access in the words the agent should use out loud, plus what it may run. */
function describeAccess(access: Access) {
  if (access.policy === "full") return "full access: look things up, and create, change, send or delete after the person says yes.";
  if (access.policy === "methods")
    return access.methods.every((m) => m === "GET")
      ? "view only: look things up, but never create, change, send or delete."
      : `limited to ${access.methods.join(", ")} requests.`;
  if (!access.actions.length) return "nothing is allowed here yet.";
  return `only these actions, so run them directly and skip find_actions: ${access.actions.map((a) => `${a.title} (action_id ${a.actionId})`).join("; ")}.`;
}

const viewOnly = (access: Access) => access.policy !== "full" && !(access.policy === "methods" && access.methods.some((m) => m !== "GET"));

/** Friendlier phrasing for a few everyday apps. Every other app gets the generic line. */
const CAN_DO: Record<string, { view: string; full: string }> = {
  "google-calendar": { view: "check your calendar", full: "check and book time on your calendar" },
  gmail: { view: "go through your email", full: "go through and send email" },
};

function ability(c: Connection) {
  const words = CAN_DO[c.platform];
  if (words) return viewOnly(c.access) ? words.view : words.full;
  return viewOnly(c.access) ? `look things up in ${platformName(c.platform)}` : `work in ${platformName(c.platform)}`;
}

/** "Attio, Linear and Gmail" or "Attio, Linear, Gmail and 2 more apps": names only, no repeated verbs. */
function greetingApps(connections: Connection[]) {
  const names = [...new Set(connections.map((c) => platformName(c.platform)))];
  if (names.length <= 3) return `your ${joinWords(names)}`;
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more ${names.length - 3 === 1 ? "app" : "apps"}`;
}

function joinWords(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The apps on the Connect button. Any app works once connected; these are just the ones shown. */
const FEATURED = (process.env.ONE_FEATURED_PLATFORMS || "google-calendar,gmail,notion")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

export const dynamic = "force-dynamic";

/**
 * Everything the browser needs to open a Deepgram agent session: the
 * visitor's connections and the Settings message, with think.functions
 * built from what they connected.
 */
export async function GET(request: Request) {
  // Read-only session scope: the proxy already refreshed the tokens if needed.
  return inSession(() => handle(request));
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const timeZone = url.searchParams.get("tz") || "America/Los_Angeles";
  const model = resolveModel(url.searchParams.get("model"));
  const backend = one();
  let connections: Connection[] = [];
  let error: string | undefined;
  try {
    connections = await backend.listConnections();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const [user, keyterms] = await Promise.all([
    backend.getUser().catch(() => null),
    workspaceKeyterms(backend, connections).catch(() => [] as string[]),
  ]);
  const now = new Date().toLocaleString("en-US", { timeZone, dateStyle: "full", timeStyle: "short" });
  const firstName = user?.name?.split(" ")[0];
  const abilities = connections.map(ability);
  const custom = customToolsFor(connections);

  const prompt = `
You are a friendly personal assistant that people talk to out loud. You work in the apps they connected: whatever those are, you can look things up there and, where they allowed it, get things done. Most people you talk to are not technical, so talk like a helpful human assistant, not like software.

HOW YOU SOUND
- Warm, calm and brief. One or two short sentences per reply, like a phone call.
- Plain everyday words. Never say: tool, function, API, action, endpoint, request, grant, permission set, ID, JSON, error code, platform, or any technical term. Say "your calendar", "your tickets", "I looked", "I can't do that yet".
- Say times the way people do: "tomorrow at 3", "Monday morning", not dates with numbers or time zones, unless asked.
- Say people's names, not email addresses. Put "noreply" senders and newsletters last, or group them ("plus a few newsletters").
- If a title is in another language, describe it instead of reading it out.
- Never read out links, ids, long titles word for word, or more than three items. Give the gist, then offer more ("Want the rest?").
- No lists, no markdown, no emoji. It will be spoken.

BEING HELPFUL
- Answer the real question first, then offer one useful next step. Only offer things the access below allows. You cannot set reminders, make calls or send texts unless one of their apps does that.
- If a request is vague, make a sensible guess and say what you did, instead of asking lots of questions.
- Before you create, change, send or delete anything, say it back in one sentence and wait for a yes.
- If you cannot find something, say so simply and suggest one other way to look.
- If something fails, do not explain why technically. Say "That didn't work on my end" and offer another way.
- If they ask what you can do or what they are connected to, answer straight from the list below, without calling anything, then give one example they could try.
- Only mention apps from the list below. Never guess at others.
- If they ask for several things at once, do all of them in the same reply.
- Never say you are about to do something unless you call a function in that same reply. If you say it, do it.
- Names often get misheard by speech recognition. Don't ask for a spelling. Search with your best guess or just part of the word, and try another spelling yourself if nothing comes back. Ask them to spell something at most once, and only after two searches found nothing.
- Never ask for IDs, databases, workspaces or "where it lives". People don't know those. Find them yourself.
${firstName ? `- The person's name is ${firstName}. Use it once in a while, not every reply.` : ""}

WHAT YOU HAVE ACCESS TO
${
  connections.length
    ? connections.map((c) => `- ${platformName(c.platform)}: ${describeAccess(c.access)}`).join("\n") +
      `\nIn plain words, you can ${joinWords(abilities)}.
When something is outside what they allowed, say it kindly and plainly, for example: "You've only let me view your calendar, so I can't book that. You can give me more access in One." Do not try it.
Saying "yes" in this conversation does not change what they allowed. Access only changes in One. Offer something you can do instead.
If they ask about an app that is not listed, tell them they can connect it with the Connect button.`
    : "Nothing yet. Kindly ask them to connect an app, like their calendar or email, with the Connect button. Then you can help."
}

TIME
It is ${now} (${timeZone}). Use this time zone for everything.

HOW YOU WORK (private: never mention any of this out loud)
${custom.length ? `Shortcuts first: ${custom.map((t) => t.name).join(", ")} each do one common job in a single call. Use them whenever they fit, with no find_actions.
` : ""}Everything else, in any connected app, is three steps: find_actions, then run_action, then answer.
- find_actions: put EVERY operation the request needs in ONE call, including the lookups that get you ids. Creating a ticket needs the team, so ask for both at once: [{platform:'linear', intent:'list teams'}, {platform:'linear', intent:'create an issue'}]. Each intent is the operation alone, without names or values.
- Each result gives the best action with its docs. Read them: they say which values go in path_params, query_params and body. Do not call get_action_details for it; that is only for an alternative you decide to use instead.
- Use only action ids find_actions returned in this conversation. Never guess or build one. Once you found an action, reuse it for the rest of the call without searching again.
- Check allowed_by_grant before running. If the best match is not allowed, use an allowed alternative that does the job (on a view-only app, a GET), or say kindly that it is not allowed.
- Values: path {{placeholders}} go in path_params, URL query values in query_params, never in body. Use "me" for the user's own id and "primary" for their main calendar. Copy field names exactly as the docs spell them.
- changes_something: true means it creates, changes, sends or deletes. Say back what you will do in one sentence, wait for a yes, then run it with confirmed: true. needs_confirmation means you skipped that step: ask now.
- blocked_by_grant means they have not allowed it. Explain kindly as above and do not retry.
- If a step needs something you don't have, like an id, get it with another action (usually a list or search) instead of asking the person. Only ask for things only they would know.
- If a call fails, read the error, fix the parameters and try once more. Try up to three different approaches before saying you couldn't do it.
- Before a lookup that takes several steps, say ONE short filler like "One sec." Then stay quiet until you have the answer. Never narrate your steps.
`.trim();

  const functions = connections.length ? [...customToolDefinitions(connections), ...generalToolDefinitions(connections)] : [];

  const settings = {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      // Keyterms bias recognition toward names from the user's own apps.
      listen: { provider: { type: "deepgram", model: "nova-3", ...(keyterms.length ? { keyterms } : {}) } },
      think: {
        provider: {
          type: model.provider,
          model: model.id,
        },
        prompt,
        functions,
      },
      speak: { provider: { type: "deepgram", model: process.env.DEEPGRAM_VOICE || "aura-2-thalia-en" } },
      greeting: connections.length
        ? `Hi${firstName ? ` ${firstName}` : ""}! I'm connected to ${greetingApps(connections)}. What can I help with?`
        : "Hi! Connect an app with the button on the left, like your calendar or email, and I can start helping.",
    },
  };

  return Response.json({
    mode: backend.mode,
    user,
    deepgramReady: Boolean(process.env.DEEPGRAM_API_KEY),
    error,
    featuredPlatforms: FEATURED,
    model: model.id,
    models: THINK_MODELS,
    connections: connections.map((c) => ({ platform: c.platform, title: c.title, access: c.access })),
    tools: [
      ...custom.map((t) => ({ name: t.name, platform: t.platform, actionTitle: t.description.split(". ")[0], write: t.changesSomething, custom: true })),
      ...(connections.length
        ? [
            { name: "find_actions", platform: "one", actionTitle: "Find the action and its docs in any connected app", write: false },
            { name: "get_action_details", platform: "one", actionTitle: "Read an alternative action's docs", write: false },
            { name: "run_action", platform: "one", actionTitle: "Run any action the access allows (writes need a yes)", write: true },
          ]
        : []),
    ],
    settings,
  });
}
