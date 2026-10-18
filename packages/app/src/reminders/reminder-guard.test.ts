import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * A reminder is its owner's alone (REQ-R1): when and on which days someone wants to be nudged
 * never reaches a peer. The store is `repos.reminders` / the `CommitmentReminderRepository` type,
 * and only `src/reminders/` (the owner-only use cases and the planner's helpers) and the adapter
 * contract suites may touch it. The notifications module asks `reminder-notices.ts`, never the
 * store. The type alone is also wired by the composition files in `REPOSITORY_TYPE_HOMES`.
 */
const ALLOWED = [/^\.\/(?!\.)/, /^\.\.\/contracts\//];
const REPOSITORY_TYPE_HOMES = [
  /^\.\.\/ports\/repositories\.ts$/,
  /^\.\.\/index\.ts$/,
  /^\.\.\/testing\//,
];

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "repository handle", pattern: /\b(repos|tx|uow|app)\s*\.\s*reminders\b/ },
  { name: "alias of reminders", pattern: /=\s*[\w.?]*\.reminders\s*[;,)\n]/ },
  {
    name: "destructured reminders",
    pattern: /\{[^}]*\breminders\b[^}]*\}\s*=\s*(repos|app|tx|uow)\b/,
  },
  { name: "read call", pattern: /\breminders\s*\.\s*(get|listEnabled|save)\s*\(/ },
];
const REPOSITORY_TYPE = /\bCommitmentReminderRepository\b/;

const outside = (allowed: readonly RegExp[]) =>
  Object.entries(SOURCES).filter(([path]) => !allowed.some((a) => a.test(path)));

describe("reminders are read inside the reminders module only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain("./commitment-reminder.repository.ts");
  });

  it("no file outside src/reminders reaches the reminder repository", () => {
    const offenders = outside(ALLOWED).flatMap(([path, source]) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(String(source))).map(
        ({ name }) => `${path}: ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("only the composition files name the repository type", () => {
    const offenders = outside([...ALLOWED, ...REPOSITORY_TYPE_HOMES])
      .filter(([, source]) => REPOSITORY_TYPE.test(String(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it.each([
    ["repository handle", "await repos.reminders.get(seasonId, commitmentId)"],
    ["alias of reminders", "const r = repos.reminders;\nr.get(a, b);"],
    ["destructured reminders", "const { reminders } = repos;"],
    ["read call", "reminders\n  .listEnabled(season.id)"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag reminder data carried on an input or a view", () => {
    for (const source of [
      "const view = await getCommitmentReminder(deps, actor, input);",
      "const due = await remindersDue(repos, context);",
      "await repos.habits.get(id);",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
