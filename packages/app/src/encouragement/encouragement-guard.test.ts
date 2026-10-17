import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * An encouragement is readable only by its recipient (and its sender for their own sends), and a
 * dismissal only by its viewer (ADR-0018, F16, REQ-X2). The stores are `repos.encouragements` and
 * `repos.nudgeDismissals` (and their port types), and only `src/encouragement/` (the use cases and
 * the viewer-scoped reads) and the adapter contract suites that exercise the ports may touch
 * them. The ports have NO season-wide read, so a peer read cannot be expressed even from inside the
 * module. The types alone are also wired by the composition files in `REPOSITORY_TYPE_HOMES`.
 */
const ALLOWED = [/^\.\/(?!\.)/, /^\.\.\/contracts\//];
const REPOSITORY_TYPE_HOMES = [
  /^\.\.\/ports\/repositories\.ts$/,
  /^\.\.\/index\.ts$/,
  /^\.\.\/testing\//,
];

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  {
    name: "read call",
    pattern:
      /\b(encouragements\s*\.\s*(listSent|listReceived|get)|nudgeDismissals\s*\.\s*listMine)\b/,
  },
  {
    name: "direct write",
    pattern: /\.\s*(encouragements|nudgeDismissals)\s*\.\s*add\s*\(/,
  },
  {
    name: "repository handle",
    pattern: /\b(repos|tx|uow|app)\s*\.\s*(encouragements|nudgeDismissals)\b/,
  },
  {
    name: "alias of a store",
    pattern: /=\s*[\w.?]*\.(encouragements|nudgeDismissals)\s*[;,)\n]/,
  },
  {
    name: "destructured store",
    pattern: /\{[^}]*\b(encouragements|nudgeDismissals)\b[^}]*\}\s*=\s*(repos|app|tx|uow)\b/,
  },
  {
    name: "destructured repository method",
    pattern:
      /\{[^}]*\b(listSent|listReceived|listMine)\b[^}]*\}\s*=\s*[\w.?]*\b(encouragements|nudgeDismissals)\b/,
  },
];
const REPOSITORY_TYPE = /\b(EncouragementRepository|NudgeDismissalRepository)\b/;

const outside = (allowed: readonly RegExp[]) =>
  Object.entries(SOURCES).filter(([path]) => !allowed.some((a) => a.test(path)));

const methodsOf = (path: string) =>
  [...String(SOURCES[path]).matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]);

describe("encouragements and dismissals are read inside the encouragement module only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain("./encouragement.repository.ts");
    expect(Object.keys(SOURCES)).toContain("./nudge-dismissal.repository.ts");
  });

  it("no file outside src/encouragement reaches either store", () => {
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

  it("the encouragement port exposes no season-wide read (a peer read cannot be expressed)", () => {
    expect(methodsOf("./encouragement.repository.ts")).toEqual([
      "listSent",
      "listReceived",
      "get",
      "add",
    ]);
  });

  it("the dismissal port exposes only the viewer's own reads", () => {
    expect(methodsOf("./nudge-dismissal.repository.ts")).toEqual(["listMine", "add"]);
  });

  it.each([
    ["read call", "await repos.encouragements.listReceived(season.id, viewer.id)"],
    ["read call", "app.encouragements\n  .listSent(seasonId, memberId)"],
    ["read call", "const mine = await tx.nudgeDismissals.listMine(a, b);"],
    ["direct write", "await app.encouragements.add(row);"],
    ["direct write", "await repos.nudgeDismissals.add(row);"],
    ["repository handle", "const rows = await repos.encouragements;"],
    ["repository handle", "uow.nudgeDismissals"],
    ["alias of a store", "const e = repos.encouragements;\ne.listSent(a, b);"],
    ["destructured store", "const { encouragements } = repos;"],
    ["destructured store", "const { habits, nudgeDismissals } = app;"],
    ["destructured repository method", "const { listReceived } = repos.encouragements;"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag encouragement data carried on an input or another aggregate's store", () => {
    for (const source of [
      "const encouragements = await loadReceived(deps, actor, seasonId);",
      "const { sent, encouragements } = loaded.value;",
      "const own = input.nudgeDismissals.filter((d) => d.caseWeek === 1);",
      "await repos.habits.get(id);",
      "await repos.feedReactions.find(a, b, c);",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
