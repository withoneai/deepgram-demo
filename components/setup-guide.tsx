import { CopyButton } from "@/components/copy-button";
import { logo } from "@/lib/platforms";
import type { SetupStatus } from "@/lib/setup";

// Shown instead of the app until .env.local has a Deepgram key and a way into One.
// Server rendered: it only ever sees booleans, never the values.

const REDIRECT_URI = "http://localhost:3030/api/one/callback";
const CONNECT_URL = "https://app.withone.ai/developers/connect";
const REPO_URL = "https://github.com/withoneai/deepgram-demo#create-the-connect-app-in-one";

export function SetupGuide({ status }: { status: SetupStatus }) {
  const c = status.connect;
  const connectReady = c.clientId && c.clientSecret && c.redirectUri;
  const oneReady = connectReady || status.oneSecret;
  const done = Number(status.deepgram) + Number(oneReady);

  const envLines: { key: string; value: string; ok: boolean; optional?: boolean }[] = [
    { key: "DEEPGRAM_API_KEY", value: "", ok: status.deepgram },
    { key: "ONE_CLIENT_ID", value: "", ok: c.clientId, optional: status.oneSecret },
    { key: "ONE_CLIENT_SECRET", value: "one_secret_…", ok: c.clientSecret, optional: status.oneSecret },
    { key: "ONE_REDIRECT_URI", value: REDIRECT_URI, ok: c.redirectUri, optional: status.oneSecret },
  ];
  const envText = [
    "DEEPGRAM_API_KEY=",
    "ONE_CLIENT_ID=",
    "ONE_CLIENT_SECRET=",
    `ONE_REDIRECT_URI=${REDIRECT_URI}`,
    "ONE_PERMISSION_SET=",
  ].join("\n");

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="flex items-center gap-3 text-[15px] font-medium tracking-tight">
          <span>Deepgram</span>
          <span className="text-faint">×</span>
          <span>One</span>
          <span className="ml-2 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-normal text-mute">Setup</span>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-mute">
          <span className="font-mono text-ink">{done}/2</span> ready
        </div>
      </header>

      <main className="mx-auto grid max-w-[1160px] gap-10 px-6 py-12 lg:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-8">
          {/* Hero */}
          <section className="rise relative flex flex-col gap-4">
            <div
              aria-hidden
              className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(63,227,165,.16), rgba(63,227,165,0) 65%)", animation: "breathe 4s ease-in-out infinite" }}
            />
            <div className="relative flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg border border-line bg-panel">
                <img src={logo("deepgram")} alt="" className="size-4" />
              </span>
              <span className="text-faint">+</span>
              <span className="grid size-8 place-items-center rounded-lg border border-line bg-panel">
                <img src={logo("one")} alt="" className="size-4" />
              </span>
            </div>
            <h1 className="relative text-[34px] font-semibold leading-[1.1] tracking-tight">
              Two keys away from
              <br />
              talking to your apps.
            </h1>
            <p className="relative max-w-[520px] text-[14px] leading-relaxed text-mute">
              The voice agent needs a Deepgram key to listen and speak, and a One Connect app so each user can plug in their own
              apps. Add them to <code className="font-mono text-ink">.env.local</code> and refresh this page.
            </p>
            <div className="relative mt-1 flex max-w-[320px] gap-1.5">
              {[status.deepgram, oneReady].map((ok, i) => (
                <div key={i} className={`h-1 flex-1 rounded-full ${ok ? "bg-spring" : "bg-line"}`} />
              ))}
            </div>
          </section>

          {/* Step 1 */}
          <Step n={1} ok={status.deepgram} title="Add your Deepgram key" logoSrc={logo("deepgram")} delay={60}>
            <p>
              Create an API key with Voice Agent access in the{" "}
              <a href="https://console.deepgram.com" target="_blank" rel="noreferrer" className="text-ink underline decoration-line underline-offset-4 hover:decoration-spring">
                Deepgram console
              </a>
              . It stays on the server: the browser talks to a local relay, never to Deepgram directly.
            </p>
            <Var name="DEEPGRAM_API_KEY" ok={status.deepgram} />
          </Step>

          {/* Step 2 */}
          <Step n={2} ok={oneReady} title="Create a Connect app in One" logoSrc={logo("one")} delay={120}>
            <p>Connect is how each user brings their own apps. About two minutes in the dashboard:</p>
            <ol className="flex flex-col gap-2.5">
              <Sub i="a">
                Open{" "}
                <a href={CONNECT_URL} target="_blank" rel="noreferrer" className="text-ink underline decoration-line underline-offset-4 hover:decoration-spring">
                  Developers → Connect
                </a>{" "}
                and click <b className="font-medium text-ink">New app</b>.
              </Sub>
              <Sub i="b">
                Give it a name. Under <b className="font-medium text-ink">What it asks for</b>, pick{" "}
                <b className="font-medium text-ink">Everything the user has connected</b>.
              </Sub>
              <Sub i="c">
                <span className="flex flex-wrap items-center gap-2">
                  Add this redirect URI exactly:
                  <code className="rounded-md border border-line bg-carbon px-2 py-0.5 font-mono text-[12px] text-ink">{REDIRECT_URI}</code>
                  <CopyButton text={REDIRECT_URI} />
                </span>
              </Sub>
              <Sub i="d">
                Create it and copy the <b className="font-medium text-ink">Client ID</b> and{" "}
                <b className="font-medium text-ink">Client secret</b>. The secret is shown once.
              </Sub>
            </ol>
            <div className="grid gap-1.5 sm:grid-cols-3">
              <Var name="ONE_CLIENT_ID" ok={c.clientId} />
              <Var name="ONE_CLIENT_SECRET" ok={c.clientSecret} />
              <Var name="ONE_REDIRECT_URI" ok={c.redirectUri} />
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-line px-3 py-2.5 text-[12px]">
              <span className={`mt-1 inline-block size-1.5 shrink-0 rounded-full ${status.oneSecret ? "bg-spring" : "bg-faint"}`} />
              <span>
                Just trying it yourself? Set <code className="font-mono text-ink">ONE_SECRET</code> to your own One key instead. The
                agent then uses your connections with full access.
              </span>
            </div>
          </Step>

          {/* Step 3 */}
          <Step n={3} ok={false} last title="Restart and talk" delay={180}>
            <p>The relay reads the Deepgram key at startup, so restart once after editing.</p>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-carbon px-3 py-2.5">
              <code className="font-mono text-[12px] text-ink">
                <span className="text-faint">$ </span>npm run dev
              </code>
              <CopyButton text="npm run dev" />
            </div>
          </Step>
        </div>

        {/* The file, live */}
        <aside className="rise flex flex-col gap-3 lg:sticky lg:top-8 lg:self-start" style={{ animationDelay: "240ms" }}>
          <div className="overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="flex gap-1">
                  <span className="size-2 rounded-full bg-line" />
                  <span className="size-2 rounded-full bg-line" />
                  <span className="size-2 rounded-full bg-line" />
                </span>
                <span className="ml-1 font-mono text-[12px] text-mute">.env.local</span>
              </div>
              <CopyButton text={envText} label="Copy template" />
            </div>
            <div className="flex flex-col py-2 font-mono text-[12px]">
              {envLines.map((l) => (
                <div key={l.key} className="flex items-center gap-3 px-4 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    <span className={l.ok ? "text-ink" : "text-mute"}>{l.key}</span>
                    <span className="text-faint">=</span>
                    <span className="text-faint">{l.ok ? "••••••••" : l.value}</span>
                  </span>
                  <Badge ok={l.ok} optional={l.optional} />
                </div>
              ))}
              <div className="px-4 py-1.5 text-faint"># or, for just you:</div>
              <div className="flex items-center gap-3 px-4 py-1.5">
                <span className="min-w-0 flex-1 truncate">
                  <span className={status.oneSecret ? "text-ink" : "text-mute"}>ONE_SECRET</span>
                  <span className="text-faint">=</span>
                  <span className="text-faint">{status.oneSecret ? "••••••••" : ""}</span>
                </span>
                <Badge ok={status.oneSecret} optional={!status.oneSecret} />
              </div>
            </div>
          </div>
          <p className="px-1 text-[12px] leading-relaxed text-faint">
            This page checks the file on every refresh and only sees whether each value is set. Full walkthrough in the{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-mute underline decoration-line underline-offset-4 hover:text-ink">
              README
            </a>
            .
          </p>
          {status.ready && (
            <a href="/" className="rounded-full bg-lime px-4 py-2 text-center text-[13px] font-medium text-carbon transition hover:opacity-90">
              Everything is set. Open the agent
            </a>
          )}
        </aside>
      </main>
    </div>
  );
}

function Step({
  n,
  ok,
  title,
  logoSrc,
  last,
  delay,
  children,
}: {
  n: number;
  ok: boolean;
  title: string;
  logoSrc?: string;
  last?: boolean;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rise relative flex gap-4" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-col items-center">
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[12px] ${
            ok ? "border-spring/50 bg-spring/10 text-spring" : "border-line bg-panel text-mute"
          }`}
        >
          {ok ? <Check /> : n}
        </span>
        {!last && <span className="mt-2 w-px flex-1 bg-line" />}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col gap-3 text-[13px] leading-relaxed text-mute ${last ? "" : "pb-2"}`}>
        <h2 className="flex items-center gap-2 pt-0.5 text-[15px] font-medium text-ink">
          {logoSrc && <img src={logoSrc} alt="" className="size-4" />}
          {title}
          {ok && <span className="rounded-full border border-spring/40 px-2 py-px text-[10px] font-normal uppercase tracking-[0.08em] text-spring">Done</span>}
        </h2>
        {children}
      </div>
    </section>
  );
}

function Sub({ i, children }: { i: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px font-mono text-[11px] text-faint">{i}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

function Var({ name, ok }: { name: string; ok: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${ok ? "border-spring/30 bg-spring/5" : "border-line bg-panel"}`}>
      <span className={`inline-block size-1.5 shrink-0 rounded-full ${ok ? "bg-spring" : "bg-alert"}`} />
      <code className={`truncate font-mono text-[11px] ${ok ? "text-ink" : "text-mute"}`}>{name}</code>
    </div>
  );
}

function Badge({ ok, optional }: { ok: boolean; optional?: boolean }) {
  if (ok) return <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-spring"><Check /> set</span>;
  if (optional) return <span className="text-[10px] uppercase tracking-[0.08em] text-faint">optional</span>;
  return <span className="text-[10px] uppercase tracking-[0.08em] text-alert">missing</span>;
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}
