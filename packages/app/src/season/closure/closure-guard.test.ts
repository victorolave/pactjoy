import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * A member's closure decisions are private to their owner (REQ-V6, REQ-V7). The store is
 * `repos.seasonClosures` / the `SeasonClosureRepository` type, and only `src/season/closure/`
 * (the owner-only use cases and the lifecycle rule) and the adapter contract suites that
 * exercise the port itself may touch it. The port has no season-wide read of decisions, so a
 * peer read cannot be expressed even from inside the module; `closedMemberIds` returns ids only.
 * The type alone is also wired by the composition files in `REPOSITORY_TYPE_HOMES`.
 */
const HOME = /^\.\/(?!\.)/;
const ALLOWED = [HOME, /^\.\.\/\.\.\/contracts\//];
const REPOSITORY_TYPE_HOMES = [
  /^\.\.\/\.\.\/ports\/repositories\.ts$/,
  /^\.\.\/\.\.\/index\.ts$/,
  /^\.\.\/\.\.\/testing\//,
];

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "read call", pattern: /\bseasonClosures\s*\.\s*(getMine|closedMemberIds)\b/ },
  { name: "direct save", pattern: /\.\s*seasonClosures\s*\.\s*save\s*\(/ },
  { name: "repository handle", pattern: /\b(repos|tx|uow|app)\s*\.\s*seasonClosures\b/ },
  { name: "alias of seasonClosures", pattern: /=\s*[\w.?]*\.seasonClosures\s*[;,)\n]/ },
  {
    name: "destructured seasonClosures",
    pattern: /\{[^}]*\bseasonClosures\b[^}]*\}\s*=\s*(repos|app|tx|uow)\b/,
  },
  {
    name: "destructured repository method",
    pattern: /\{[^}]*\b(getMine|closedMemberIds)\b[^}]*\}\s*=\s*[\w.?]*\bseasonClosures\b/,
  },
];
const PORT = "./season-closure.repository.ts";
const REPOSITORY_TYPE = /\bSeasonClosureRepository\b/;

const outside = (allowed: readonly RegExp[]) =>
  Object.entries(SOURCES).filter(([path]) => !allowed.some((a) => a.test(path)));

describe("closures are read inside the season/closure module only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain(PORT);
  });

  it("no file outside src/season/closure reaches the closure repository", () => {
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

  it("the port exposes no season-wide read of decisions (ids only)", () => {
    const port = String(SOURCES[PORT] ?? "");
    const methods = [...port.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]);
    expect(methods).toEqual(["getMine", "closedMemberIds", "save"]);
    expect(port).toMatch(/closedMemberIds\(seasonId: SeasonId\): Promise<readonly MemberId\[\]>/);
  });

  it.each([
    ["read call", "await repos.seasonClosures.getMine(season.id, member.id)"],
    ["read call", "seasonClosures\n  .closedMemberIds(seasonId)"],
    ["direct save", "await app.seasonClosures.save(closure, null);"],
    ["repository handle", "const rows = await repos.seasonClosures;"],
    ["alias of seasonClosures", "const r = repos.seasonClosures;\nr.getMine(id);"],
    ["destructured seasonClosures", "const { seasonClosures } = repos;"],
    ["destructured repository method", "const { closedMemberIds } = repos.seasonClosures;"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag closure data carried on an input or another aggregate's store", () => {
    for (const source of [
      "const closures = await listOwnClosures(deps, actor, seasonId);",
      "const { entry, closure } = loaded.value;",
      "const own = input.seasonClosures.filter((c) => c.memberId === id);",
      "await repos.habits.get(id);",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
