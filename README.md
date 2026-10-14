# Deepgram × One: a voice agent for any app

Talk to your apps out loud. This is a voice agent on [Deepgram's Voice Agent API](https://developers.deepgram.com/docs/voice-agent) that can work in any app a user connects through [One](https://www.withone.ai): calendar, email, CRM, Notion, Linear, Stripe, HubSpot and 690+ others. Each user brings their own apps with [One Connect](https://www.withone.ai/products/connect) and decides what the agent may do in each one.

There is no code per app. Three general tools reach everything, and you add a custom tool (one small file) only when you want a faster path for a job that comes up all the time.

## How it works

- **Deepgram** runs the conversation over one WebSocket: Nova-3 listens, a language model decides what to do, Aura-2 speaks.
- When the model wants to do something, Deepgram sends a `FunctionCallRequest`. The browser posts it to `/api/tools/call`, which runs it as a **One** action under the user's grant and sends a trimmed `FunctionCallResponse` back.
- **One Connect** gives each user their own grant. One checks it on every call, so a view-only calendar stays view only, whatever the agent is asked.

```
browser (mic, speaker, UI)
  ├── ws://localhost:3031  relay.mjs ──► wss://agent.deepgram.com/v1/agent/converse   (your Deepgram key stays server-side)
  └── /api/tools/call      Next.js   ──► api.withone.ai/v1                           (the user's Connect grant)
```

## Run it

```bash
git clone https://github.com/withoneai/deepgram-demo
cd deepgram-demo && npm install
cp .env.example .env.local   # add DEEPGRAM_API_KEY, then the Connect values below
npm run dev                  # app on http://localhost:3030, relay on :3031
```

Use Chrome and wear headphones so the agent does not hear itself. You can also type a turn in the box under the call.

### Let each user connect their own apps

1. In the One dashboard, open **Developers → Connect → New app**.
2. Register the redirect URI `http://localhost:3030/api/one/callback`.
3. Choose the apps the agent may work in. Any app works; `ONE_FEATURED_PLATFORMS` only picks the logos on the Connect button.
4. Put the client id, client secret and permission set id in `.env.local`, and restart.

Press **Connect your apps**, sign in to One with the emailed code, pick your apps and set the access for each.

No Connect app yet? Leave those values empty and set `ONE_SECRET` instead. The agent then uses the first connection of each platform in your own One account, with full access. Good for trying the voice loop, not for other people.

## The tools

Everything the model can call is in [`lib/tools/`](lib/tools):

| File | What's in it |
| --- | --- |
| [`lib/tools/one-tools.ts`](lib/tools/one-tools.ts) | The three general tools that reach any connected app |
| [`lib/tools/custom/`](lib/tools/custom) | Custom tools, one file each, plus the list in `index.ts` |
| [`lib/tools/custom/types.ts`](lib/tools/custom/types.ts) | The shape of a custom tool |

See the exact JSON Deepgram receives in `agent.think.functions`:

```bash
npm run print-tools                  # as if the user connected attio, gmail, google-calendar
npm run print-tools -- linear slack  # any platforms you like
```

### The three general tools

| Tool | Does |
| --- | --- |
| `find_actions` | One picks the action for each step of the request and returns its docs. Several steps go in one call ("list teams" and "create an issue" together) |
| `get_action_details` | Docs for an alternative, when the best match is not the right one |
| `run_action` | Runs the action under the user's grant. Anything that creates, changes, sends or deletes is refused until the user said yes out loud (`confirmed: true`) |

They're run by [`lib/catalog.ts`](lib/catalog.ts). The system prompt ([`app/api/agent/config/route.ts`](app/api/agent/config/route.ts)) is built each session from the user's connections and access, so the agent only offers what it can actually do.

### The three One calls behind them

That's all the app needs from One. They're in [`lib/one.ts`](lib/one.ts), and they're the same three steps One's CLI and MCP server use, so anything you try in the CLI works the same way here.

| Step | One API | In this app (Connect SDK) | One CLI | One MCP |
| --- | --- | --- | --- | --- |
| Find the action | `POST /v1/available-actions/find` | `findActions()` | `one actions find <platform> "<intent>"` | `find_one_actions` |
| Read its docs | `GET /v1/knowledge?_id=<actionId>` | `getKnowledge()` | `one actions load <actionId>` | `find_one_actions` with `load` |
| Run it | the action, under the user's grant | `runAction()` | `one actions execute <platform> <actionId> <connectionKey>` | `execute_one_action` |

Plus `listConnections()`, which tells the agent what the user connected and what each grant allows.

### Custom tools

A custom tool pins one One action behind a name and a schema written for the model. The model calls it in one step with no search, so use one for a job the agent does constantly. Two examples ship:

- [`attio-search-people.ts`](lib/tools/custom/attio-search-people.ts): `search_people` searches Attio people by name, email, domain or phone.
- [`gmail-create-draft.ts`](lib/tools/custom/gmail-create-draft.ts): `draft_email` saves a Gmail draft. Nothing is sent, and the agent still asks first.

Each one is the action id, a parameter schema, and two small functions: `request` maps the model's arguments to the action's request, and `result` trims the response to what a spoken answer needs. A tool only appears for users who connected its platform and whose access allows the action, and it runs under their grant like everything else.

**Write one with the One CLI**

```bash
npm i -g @withone/cli && one init

# 1. Find the action and read its docs
one actions find hubspot "search contacts" --task "look up a CRM contact"
one actions load <actionId>

# 2. Try it against a real connection before writing code
one list                                            # your connection keys
one actions execute hubspot <actionId> <connectionKey> -d '{"query":"jane"}'
```

Then copy [`attio-search-people.ts`](lib/tools/custom/attio-search-people.ts), put in the action id, method and path, write `request` and `result`, and add the tool to `CUSTOM_TOOLS` in [`lib/tools/custom/index.ts`](lib/tools/custom/index.ts).

**Or let your coding agent write it, with the One MCP server**

Add `https://mcp.withone.ai/mcp` to Claude Code, Cursor or any MCP client, then ask:

> Using One, find the action that searches HubSpot contacts, read its docs, run it once to check the response, and write `lib/tools/custom/hubspot-search-contacts.ts` following `attio-search-people.ts`. Then add it to `CUSTOM_TOOLS`.

The agent uses `find_one_actions` and `execute_one_action` to get the same id and docs the CLI shows, and checks the real response shape before writing `result`.

## Speech

Before each call, [`lib/vocab.ts`](lib/vocab.ts) gathers names from the user's apps when Notion or Attio is connected (recent page titles, newest people and companies) and passes them to Nova-3 as key terms, so names are heard correctly. It's optional and not a tool.

## Choosing the model

Pick the model in the app's left panel; the choice is kept in the browser and applies from the next call. `DEEPGRAM_THINK_MODEL` sets the default, and `lib/models.ts` holds the list. The model matters more than anything else in the stack. On the same questions:

| Model | Answer, calendar question | How it did |
| --- | --- | --- |
| GPT-5.5 (default) | about 3.7s | Right every time; looks up the team before asking to create an issue |
| GPT-5.4 mini | 3.2 to 3.6s | Fast, but asks to create the issue before it knows the team |
| Gemini 3.5 Flash | about 6.2s | Right answers, slower |
| Claude Sonnet 4.6 | 5.9 to 6.3s | Right answers, too slow for voice |

Times are from a typed question to the first spoken words, with a find and a run in between. GPT-5.6 Terra and Luna are listed by Deepgram but refused to think on our account.

## Sessions: tokens never touch the server

The Connect token pair lives in the visitor's browser as a sealed cookie: AES-256-GCM, httpOnly, SameSite=Lax, with the session's user id sealed inside so one person's grant can never be read as another's. `proxy.ts` refreshes the pair ten minutes before it expires, before any route runs, so no request ever rotates tokens halfway through. Each browser is its own user.

```bash
npm test   # 11 checks on the session: round trip, wrong user, tamper, old secret, chunking, sign-out, two tabs, isolation, cookie flags
```

If your app has its own login, return your real user id from `requestSession()` in `lib/one-connect.ts` and in `proxy.ts` instead of the per-browser id.

## What it does not do

- It never acts outside what the user granted in One.
- It keeps no tokens on the server. Disconnect clears them from the browser; the grant itself is revoked in the One dashboard.
- It does not act while you are away. It works during a call, with the user present.

## License

MIT
