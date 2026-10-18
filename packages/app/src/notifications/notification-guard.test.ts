import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The outbox and the push subscriptions are a choke point (ADR-0017): only `src/notifications/`
 * (enqueue, plan, dispatch, the subscription use cases) and the adapter contract suites may touch
 * `repos.notifications` / `repos.pushSubscriptions`. Other modules add notices through
 * `enqueueNotices`, so every notice gets the same shape, and an endpoint or its keys can never
 * reach a module that answers a peer. The repository types are also wired by the composition files
 * in `REPOSITORY_TYPE_HOMES`. Tests elsewhere may read the in-memory outbox to assert what a use
 * case enqueued: the guard is about production code.
 */
const ALLOWED = [/^\.\/(?!\.)/, /^\.\.\/contracts\//, /\.test\.ts$/];
const REPOSITORY_TYPE_HOMES = [
  /^\.\.\/ports\/repositories\.ts$/,
  /^\.\.\/index\.ts$/,
  /^\.\.\/testing\//,
];

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  {
    name: "repository handle",
    pattern: /\b(repos|tx|uow|app|repositories)\s*\.\s*(notifications|pushSubscriptions)\b/,
  },
  { name: "alias", pattern: /=\s*[\w.?]*\.(notifications|pushSubscriptions)\s*[;,)\n]/ },
  {
    name: "destructured",
    pattern:
      /\{[^}]*\b(notifications|pushSubscriptions)\b[^}]*\}\s*=?\s*(repos|app|tx|uow)?\)?\s*(=>|=)/,
  },
];
const REPOSITORY_TYPE = /\b(NotificationOutboxRepository|PushSubscriptionRepository)\b/;

const outside = (allowed: readonly RegExp[]) =>
  Object.entries(SOURCES).filter(([path]) => !allowed.some((a) => a.test(path)));

describe("the outbox and push subscriptions are used inside src/notifications only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain("./notification-outbox.repository.ts");
  });

  it("no file outside src/notifications reaches either repository", () => {
    const offenders = outside(ALLOWED).flatMap(([path, source]) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(String(source))).map(
        ({ name }) => `${path}: ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("only the composition files name the repository types", () => {
    const offenders = outside([...ALLOWED, ...REPOSITORY_TYPE_HOMES])
      .filter(([, source]) => REPOSITORY_TYPE.test(String(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it.each([
    ["repository handle", "await repos.notifications.enqueue(rows);"],
    ["repository handle", "await tx.pushSubscriptions.listByUser(id);"],
    ["alias", "const outbox = repos.notifications;\noutbox.enqueue(rows);"],
    ["destructured", "async ({ notifications }) => notifications.enqueue(rows)"],
    ["destructured", "const { pushSubscriptions } = repos;"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag the exported helper or unrelated stores", () => {
    for (const source of [
      "await enqueueNotices(repos, drafts);",
      "const notices = drafts.map(toNotice);",
      "await repos.habits.get(id);",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
