import "server-only";
import type { Connection, OneBackend } from "./one";

/**
 * Words the speech model should expect: names from the user's own apps.
 * Nova-3 "keyterms" bias recognition toward them, so a company name like "Fireflies"
 * is heard as one word instead of "fire flies". Pulled live, capped, and never
 * allowed to slow the session: anything slower than the budget is skipped.
 */

/** A Notion page's title, wherever Notion keeps it. */
function notionTitle(r: any): string {
  const prop: any = Object.values(r?.properties ?? {}).find((p: any) => p?.type === "title");
  return ((prop?.title ?? r?.title ?? []) as any[]).map((t) => t.plain_text).join("").trim();
}

const BASE = ["One", "Deepgram", "Attio", "Notion", "Gmail", "Google Calendar"];
const MAX_TERMS = 60;
const BUDGET_MS = 1500;

const COMMON = new Set(
  "the and for with from your this that into about deep dive notes plan test item page new sync update launch checklist ideas rollout weekly daily meeting agreement services decision brief campaign intel impact create series teammate digest daily news".split(" "),
);

function within<T>(promise: Promise<T>, fallback: T) {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), BUDGET_MS))]).catch(() => fallback);
}

/** Distinctive capitalized words and short names from a title. */
function termsFrom(text: string) {
  return (text.match(/[A-Z][A-Za-z0-9.&'-]{2,}(?:\s+[A-Z][A-Za-z0-9.&'-]{2,})?/g) ?? [])
    .map((t) => t.replace(/[.'-]+$/, ""))
    .filter((t) => !COMMON.has(t.toLowerCase()) && t.length <= 30);
}

export async function workspaceKeyterms(backend: OneBackend, connections: Connection[]): Promise<string[]> {
  const byPlatform = (p: string) => connections.find((c) => c.platform === p);
  const notion = byPlatform("notion");
  const attio = byPlatform("attio");

  const notionTitles = notion
    ? within(
        backend
          .runAction({
            connectionKey: notion.key,
            actionId: "conn_mod_def::GJ5En67fz04::-CJAS419SVWm7L2l6brp6A",
            method: "POST",
            path: "/search",
            body: { query: "", page_size: 30, filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" } },
          })
          .then((r) => ((r.data as any)?.results ?? []).map(notionTitle) as string[]),
        [] as string[],
      )
    : Promise.resolve([] as string[]);

  const attioNames = (object: "companies" | "people") =>
    attio
      ? within(
          backend
            .runAction({
              connectionKey: attio.key,
              actionId: "conn_mod_def::GJ0CbN-LPiU::A6h6M9QkS0Cs2Lt9CdPH7Q",
              method: "POST",
              path: `/objects/${object}/records/query`,
              body: { limit: 15, sorts: [{ attribute: "created_at", direction: "desc" }] },
            })
            .then((r) =>
              ((r.data as any)?.data ?? [])
                .map((x: any) => x.values?.name?.[0]?.full_name ?? x.values?.name?.[0]?.value)
                .filter(Boolean) as string[],
            ),
          [] as string[],
        )
      : Promise.resolve([] as string[]);

  const [titles, companies, people] = await Promise.all([notionTitles, attioNames("companies"), attioNames("people")]);
  const clean = (t: string) =>
    t
      .replace(/[^\p{L}\p{N} .&'-]/gu, "")
      .replace(/^(with|and|for|the)\s+/i, "")
      .replace(/[\s,.&'-]+$/, "")
      .trim();
  const terms = [...BASE, ...companies, ...people.filter((n) => /^[A-Za-z .'-]+$/.test(n) && n.length > 3), ...titles.flatMap(termsFrom)];
  const usable = terms.map(clean).filter((t) => t.length > 2 && t.split(/\s+/).length <= 3 && !COMMON.has(t.toLowerCase()));
  return [...new Map(usable.map((t) => [t.toLowerCase(), t])).values()].slice(0, MAX_TERMS);
}
