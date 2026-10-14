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

### Create the Connect app in One

Connect is what lets each person who uses your agent bring their own apps. You create one Connect app in the One dashboard, and every user grants it access to their tools on One's consent page. It takes about two minutes.

**1. Open the studio.** Sign in and open [**Developers → Connect**](https://app.withone.ai/developers/connect) in the One dashboard, then click **New app**. The form is on the left, and a live preview of the consent card your users will see is on the right. There are three steps.

**2. Who is asking.** This is what users see on the consent page.

| Field | What to put |
| --- | --- |
| **Name** | Required. For example "Deepgram Voice Agent". |
| **Logo URL** | Optional. A public, square image, around 128px. |
| **Why you're asking** | Optional, up to 200 characters. For example "Talks to your calendar, email and CRM so you can get things done out loud." |

**3. What it asks for.** Pick one:

- **Everything the user has connected** (recommended for this demo). Users tick which of their connections to share, and the agent works in all of them. This is the "any app" story, and you leave `ONE_PERMISSION_SET` empty.
- **Specific connectors and scopes.** Pick each app and how far the agent may go: **Read only**, **Read & write** (no deletes), **Full access**, or **Custom** (individual actions). Users can narrow this on the consent page, never widen it. Creating the app saves the list as its **Default ask**, and its **Ask id** goes in `ONE_PERMISSION_SET`.

The agent reads the access back on every session, so its prompt and tools match what each user allowed. A read-only grant gets an agent that only reads.

**4. Where users return.** Under **Redirect URIs**, add this exactly:

```
http://localhost:3030/api/one/callback
```

The match is exact (scheme, host, port, path). Plain `http` is only accepted for localhost. Add your deployed URL on its own line when you ship, for example `https://voice.yourapp.com/api/one/callback`.

**5. Create the app and copy the credentials.** Click **Create app**. On the app's page, under **Credentials**:

- **Client ID**: copy it with the chip next to it.
- **Client secret**: starts with `one_secret_` and is **shown once**. Copy it now. If you lose it, **Regenerate** makes a new one and the old one stops working.
- **Ask id**: only for a Specific app. It's on the **What it asks for** card or the **Asks** tab.

This demo runs Connect in token mode, so you don't need a connect key (`sk_live_…`). Each user's token pair is sealed into their own browser cookie (see [Sessions](#sessions-tokens-never-touch-the-server)).

**6. Fill in `.env.local` and restart.**

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_REDIRECT_URI=http://localhost:3030/api/one/callback   # exactly the registered URI
ONE_PERMISSION_SET=                                       # the Ask id, or empty for "Everything"
ONE_FEATURED_PLATFORMS=google-calendar,gmail,attio        # logos on the button only; any app works
```

**7. Connect.** Open http://localhost:3030 and press **Connect your apps**. Sign in to One with the emailed code, pick your apps, set the access for each and approve. You come back connected, and the left panel lists your apps and the tools the agent got.

To revoke, use **Disconnect from One** in the app, which clears the cookie. To revoke the grant itself, remove the app from your One dashboard, and it takes effect on the next call. Full reference: [One Connect docs](https://www.withone.ai/docs/connect/setup).

**Troubleshooting**

- *"redirect URI doesn't match"*: `ONE_REDIRECT_URI` and the registered URI differ, even by a trailing slash or a port.
- *The consent page asks for the wrong apps*: check `ONE_PERMISSION_SET`. Empty means everything the user connected.
- *Lost the client secret*: **Regenerate** it on the app's page and update `.env.local`.

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

**How to add one: ask your coding agent, which uses the One CLI**

You don't look up action ids or read API docs yourself. Your coding agent (Claude Code, Cursor, Codex or any agent with a terminal) does it with the One CLI. That's how the two examples here were built.

One-time setup, done by you:

```bash
npm i -g @withone/cli
one init        # signs you in to One and installs the One skill into your coding agents
one add hubspot # connect the app you want a tool for, so the agent can test against it
```

Then ask your agent, from this repo:

> Add a custom tool that searches HubSpot contacts. Use the One CLI to find the action and read its docs, run it once against my connection to see the real response, then write `lib/tools/custom/hubspot-search-contacts.ts` following `attio-search-people.ts` and add it to `CUSTOM_TOOLS`.

The agent runs the same three steps the voice agent uses at runtime, through the CLI:

```bash
one --agent actions find hubspot "search contacts" --task "look up a CRM contact"  # picks the action, returns its docs
one --agent actions load <actionId>                                                # any docs section the find left out
one --agent actions execute hubspot <actionId> <connectionKey> -d '{"query":"jane"}'  # a real call, to see the response shape
```

From that it fills in the action id, method and path, writes `request` from the docs and `result` from the real response, and registers the tool in [`lib/tools/custom/index.ts`](lib/tools/custom/index.ts). Restart `npm run dev`, and the tool shows up for every user who connected HubSpot with access to that action. Check it with `npm run print-tools -- hubspot`.

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
