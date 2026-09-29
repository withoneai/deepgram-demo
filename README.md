# deepgram-voice-agent

Talk to your calendar, inbox, CRM and Notion, and decide exactly what the agent may touch.

A voice agent built on [Deepgram's Voice Agent API](https://developers.deepgram.com/docs/voice-agent). You ask out loud, it checks your calendar, reads your email, looks people up in Attio and searches Notion, and answers in about a second. Every call runs through [One](https://www.withone.ai), and each user brings their own apps with [One Connect](https://www.withone.ai/products/connect) and sets what the agent is allowed to do in each one.

Walkthrough and write-up: [withone.ai/use-cases/deepgram-voice-agent](https://www.withone.ai/use-cases/deepgram-voice-agent)

## How it works

- **Deepgram** runs the conversation over one WebSocket: Nova-3 listens, a language model decides what to do, Aura-2 speaks.
- When the model wants to do something, Deepgram sends a `FunctionCallRequest`. The browser posts it to `/api/tools/call`, which runs it as a **One** action under the user's grant and sends a trimmed `FunctionCallResponse` back.
- **One Connect** gives each visitor their own grant. One checks it on every call, so a view-only calendar stays view only whatever the agent is asked.

```
browser (mic, speaker, UI)
  ├── ws://localhost:3031  relay.mjs ──► wss://agent.deepgram.com/v1/agent/converse   (your Deepgram key stays server-side)
  └── /api/tools/call      Next.js   ──► api.withone.ai/v1/passthrough/...          (the user's Connect grant)
```

## Run it

```bash
git clone https://github.com/withoneai/deepgram-voice-agent
cd deepgram-voice-agent && npm install
cp .env.example .env.local   # add DEEPGRAM_API_KEY, then the Connect values below
npm run dev                  # app on http://localhost:3030, relay on :3031
```

Use Chrome and wear headphones, so the agent does not hear itself. The text box under the call lets you type a turn instead of speaking it.

### Let each user connect their own apps

1. In the One dashboard, open **Developers → Connect → New app**.
2. Register the redirect URI `http://localhost:3030/api/one/callback`.
3. Ask for the apps the agent uses: Google Calendar, Gmail, Attio and Notion.
4. Put the client id, client secret and permission set id in `.env.local`, and restart.

Press **Connect your apps**, sign in to One with the emailed code, pick your apps and set the access for each. You come back connected.

No Connect app yet? Leave those values empty and set `ONE_SECRET` instead. The agent then uses the first connection of each platform in your own One account, with full access. Good for trying the voice loop, not for other people.

## What the agent can do

Fast shortcuts for common questions, each one hop through One (`lib/tools.ts`):

| Tool | Does |
| --- | --- |
| `calendar_upcoming_events` | Upcoming events, optionally filtered by a name |
| `calendar_check_availability` | When you are free. Reads events instead of `/freeBusy`, which is a POST that a view-only grant rightly blocks |
| `calendar_create_event` | Adds an event, only after the user's turn ends and only if the grant allows it |
| `email_unread` | Latest unread email with sender and subject, fetched in parallel |
| `crm_recent`, `crm_lookup` | Newest people or companies in Attio, or a lookup by name, email or domain |
| `notion_search`, `notion_read_page` | Search Notion by title and open the best match. No page or database ID needed |

For everything else, three general tools (`lib/catalog.ts`): find an action in any connected app, read how to call it, and run it. The grant still decides what actually runs.

Before each call, `lib/vocab.ts` gathers names from the user's apps (recent Notion titles, the newest Attio people and companies) and passes them to Nova-3 as key terms, so names are heard correctly.

## Sessions: tokens never touch the server

The Connect token pair lives in the visitor's browser as a sealed cookie: AES-256-GCM, httpOnly, SameSite=Lax, with the session's user id sealed inside so one person's grant can never be read as another's. `proxy.ts` refreshes the pair ten minutes before it expires, before any route runs, so no request ever rotates tokens halfway through. Each browser is its own user.

```bash
npm test   # 11 checks on the session: round trip, wrong user, tamper, old secret, chunking, sign-out, two tabs, isolation, cookie flags
```

If your app has its own login, return your real user id from `requestSession()` in `lib/one-connect.ts` and in `proxy.ts` instead of the per-browser id.

## Choosing the model

`DEEPGRAM_THINK_MODEL` picks the model that does the thinking. It matters more than anything else in the stack. On the same questions:

| Model | First words | How it did |
| --- | --- | --- |
| GPT-5.4 mini (default) | about 1.1s | Answered everything, fewest tool calls |
| Claude Haiku 4.5 | 1.2 to 3.7s | Right answers, but narrated its steps |
| GPT-4.1 mini | about 1.1s | Fast, but gave up on multi-step tasks |
| Claude Sonnet 5 | 2.3 to 12s | Most natural, too slow for voice |

## What it does not do

- It never acts outside what the user granted in One.
- It keeps no tokens on the server. Disconnect clears them from the browser; the grant itself is revoked in the One dashboard.
- It does not act while you are away. It works during a call, with the user present.

## License

MIT
