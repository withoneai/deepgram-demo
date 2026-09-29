import { inSession } from "@/lib/one-connect";
import { one } from "@/lib/one";
import { availableTools, deepgramFunctions } from "@/lib/tools";
import { generalToolDefinitions } from "@/lib/catalog";
import { workspaceKeyterms } from "@/lib/vocab";
import type { Access } from "@/lib/one";

const NAMES: Record<string, string> = { "google-calendar": "Google Calendar", gmail: "Gmail", attio: "Attio", notion: "Notion" };

/** Access in the words the agent should use out loud. */
function describeAccess(access: Access) {
  if (access.policy === "full") return "full access. You can look things up and also create, update or delete things there.";
  if (access.policy === "methods")
    return access.methods.every((m) => m === "GET")
      ? "view only. You can look things up, but you cannot create, change, send or delete anything there."
      : `limited access (${access.methods.join(", ")} requests only).`;
  return `a few specific things only: ${access.actions.map((a) => a.title).join("; ")}.`;
}

/** What someone can ask for, per app, for the greeting and "what can you do". */
const CAN_DO: Record<string, { view: string; full: string }> = {
  "google-calendar": { view: "check your calendar", full: "check and book time on your calendar" },
  gmail: { view: "go through your email", full: "go through and send email" },
  attio: { view: "look people up in Attio", full: "look up and update people in Attio" },
  notion: { view: "find things in Notion", full: "find and write things in Notion" },
};

function joinWords(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

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
  const backend = one();
  let connections: Awaited<ReturnType<typeof backend.listConnections>> = [];
  let error: string | undefined;
  try {
    connections = await backend.listConnections();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const tools = availableTools(connections);
  const [user, keyterms] = await Promise.all([
    backend.getUser().catch(() => null),
    workspaceKeyterms(backend, connections).catch(() => [] as string[]),
  ]);
  const now = new Date().toLocaleString("en-US", { timeZone, dateStyle: "full", timeStyle: "short" });

  const appName = (platform: string, title?: string) => NAMES[platform] ?? title ?? platform;
  const ORDER = ["google-calendar", "gmail", "attio", "notion"];
  const rankOf = (p: string) => (ORDER.indexOf(p) + 1 || ORDER.length + 1);
  const abilities = [...connections].sort((a, b) => rankOf(a.platform) - rankOf(b.platform)).map((c) => {
    const words = CAN_DO[c.platform];
    const viewOnly = c.access.policy !== "full";
    return words ? (viewOnly ? words.view : words.full) : `work in ${appName(c.platform, c.title)}`;
  });
  const firstName = user?.name?.split(" ")[0];

  const prompt = `
You are a friendly personal assistant that people talk to out loud. You help with their everyday apps: calendar, email, contacts, notes. Most people you talk to are not technical, so talk like a helpful human assistant, not like software.

HOW YOU SOUND
- Warm, calm and brief. One or two short sentences per reply, like a phone call.
- Plain everyday words. Never say: tool, function, API, action, endpoint, request, grant, permission set, ID, JSON, error code, platform, or any technical term. Say "your calendar", "your email", "I looked", "I can't do that yet".
- Say times the way people do: "tomorrow at 3", "Monday morning", not dates with numbers or time zones, unless asked.
- Say people's names, not email addresses. Drop "noreply" senders and newsletters to the end, or group them ("plus a few newsletters").
- If a title is in another language, describe it instead of reading it ("an Arabic version of the launch plan").
- Never read out links, long subjects word for word, or more than three items. Give the gist, then offer more ("Want the rest?").
- No lists, no markdown, no emoji. It will be spoken.

BEING HELPFUL
- Answer the real question first, then offer one useful next step ("Want me to find a free slot?"). Only offer things you can actually do with the access below. You cannot set reminders, make calls or send texts.
- If a request is vague, make a sensible guess and say what you did, instead of asking lots of questions.
- Before you create, change or send anything, say it back in one sentence and wait for a yes.
- If you cannot find something, say so simply and suggest one other way to look.
- If something fails, do not explain why technically. Say "That didn't work on my end" and offer to try another way.
- If the person asks what you can do, answer in one sentence from the list below, then give one example they could try.
- If they ask for several things at once, do all of them in the same reply. Don't answer one and ask about the other.
- Never say you are about to do something ("I'll look that up now") unless you call a function in that same reply. If you say it, do it.
- Names often get misheard by speech recognition ("fire flies" is probably "Fireflies"). Don't ask for a spelling. Search with your best guess or just part of the word (like "reach"), and try another spelling yourself if nothing comes back. Ask them to spell something at most once, and only after two searches found nothing.
- Never ask for IDs, databases or "where it lives". People don't know those. Find it yourself.
${firstName ? `- The person's name is ${firstName}. Use it once in a while, not every reply.` : ""}

WHAT YOU HAVE ACCESS TO
${
  connections.length
    ? connections.map((c) => `- ${appName(c.platform, c.title)}: ${describeAccess(c.access)}`).join("\n") +
      `\nIn plain words, you can ${joinWords(abilities)}.
When something is outside what they allowed, say it kindly and plainly, for example: "You've only let me view your calendar, so I can't book that. You can give me more access in One." Do not try again.
Saying "yes" in this conversation does not change what they allowed. Access only changes in One, and they would need to reconnect. Until then, do not attempt it; offer something you can do instead, like telling them when they're free.`
    : "Nothing yet. Kindly ask them to connect an app like their calendar or email using the Connect button, then you can help."
}

TIME
It is ${now} (${timeZone}). Use this time zone for everything.

HOW YOU WORK (private: never mention any of this out loud)
- For calendar, email and contact questions, use the quick calendar_*, email_unread, crm_recent and crm_lookup functions.
- For Notion, use notion_search: it needs no ID, opens the best match, and an empty query gives the most recent pages (use that for "the root", "any page", "something recent"). Use notion_read_page for another match. Only fall back to find_actions for Notion writes.
- For anything else in a connected app: find_actions, then get_action_details, then run_action. Only use action ids that find_actions returned in this conversation; never guess one.
- A view-only app allows GET actions. If the best match is not allowed, look for an allowed GET alternative before saying you can't.
- If a result says blocked_by_grant, the person has not allowed that. Explain it kindly as above and do not retry.
- Before a lookup that takes several steps, say ONE short filler like "One sec, let me look." Then stay quiet until you have the answer. Never narrate your steps ("let me get the details", "now let me query").
- If a step needs something you don't have, like an ID, get it yourself with another action (usually a search or list) instead of asking the person. Only ask them for things only they would know.
- Don't give up after one miss. Try up to three different approaches before saying you couldn't do it.
`.trim();

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
          type: process.env.DEEPGRAM_THINK_PROVIDER || "open_ai",
          model: process.env.DEEPGRAM_THINK_MODEL || "gpt-5.4-mini",
        },
        prompt,
        functions: [...deepgramFunctions(tools.map((t) => t.tool)), ...(connections.length ? generalToolDefinitions(connections) : [])],
      },
      speak: { provider: { type: "deepgram", model: process.env.DEEPGRAM_VOICE || "aura-2-thalia-en" } },
      greeting: connections.length
        ? `Hi${firstName ? ` ${firstName}` : ""}! I can ${joinWords(abilities.slice(0, 3))}. What can I help with?`
        : "Hi! Connect your calendar or email with the button on the left, and I can start helping.",
    },
  };

  return Response.json({
    mode: backend.mode,
    user,
    deepgramReady: Boolean(process.env.DEEPGRAM_API_KEY),
    error,
    connections: connections.map((c) => ({ platform: c.platform, title: c.title, access: c.access })),
    tools: [
      ...tools.map(({ tool }) => ({
        name: tool.name,
        platform: tool.platform,
        actionTitle: tool.actionTitle,
        write: tool.deferUntilEot === true,
      })),
      ...(connections.length
        ? [
            { name: "find_actions", platform: "one", actionTitle: "Search any connected app's actions", write: false },
            { name: "get_action_details", platform: "one", actionTitle: "Read an action's docs", write: false },
            { name: "run_action", platform: "one", actionTitle: "Run any action the grant allows", write: true },
          ]
        : []),
    ],
    settings,
  });
}
