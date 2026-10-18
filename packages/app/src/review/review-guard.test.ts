import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * Reviews, reflections and SRBAI answers are private to their owner (REQ-V1, REQ-V4). The store
 * is `repos.reviews` / the `ReviewRepository` type, and only `src/review/` (the owner-only use
 * cases and queries) and the adapter contract suites that exercise the port itself may touch it.
 * This is a privacy choke point, not a freshness one: the stored rows are final. The port also
 * has no season-wide read, so a peer read cannot be expressed even from inside the module. The
 * type alone is also wired by the composition files in `REPOSITORY_TYPE_HOMES`.
 */
const ALLOWED = [/^\.\/(?!\.)/, /^\.\.\/contracts\//];
const REPOSITORY_TYPE_HOMES = [
  /^\.\.\/ports\/repositories\.ts$/,
  /^\.\.\/index\.ts$/,
  /^\.\.\/testing\//,
];

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "read call", pattern: /\breviews\s*\.\s*listMine\b/ },
  { name: "direct save", pattern: /\.\s*reviews\s*\.\s*save\s*\(/ },
  { name: "repository handle", pattern: /\b(repos|tx|uow|app)\s*\.\s*reviews\b/ },
  { name: "alias of reviews", pattern: /=\s*[\w.?]*\.reviews\s*[;,)\n]/ },
  {
    name: "destructured reviews",
    pattern: /\{[^}]*\breviews\b[^}]*\}\s*=\s*(repos|app|tx|uow)\b/,
  },
  {
    name: "destructured repository method",
    pattern: /\{[^}]*\b(listMine)\b[^}]*\}\s*=\s*[\w.?]*\breviews\b/,
  },
];
const REPOSITORY_TYPE = /\bReviewRepository\b/;

const outside = (allowed: readonly RegExp[]) =>
  Object.entries(SOURCES).filter(([path]) => !allowed.some((a) => a.test(path)));

describe("reviews are read inside the review module only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain("./review.repository.ts");
  });

  it("no file outside src/review reaches the Review repository", () => {
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

  it("the port exposes no season-wide read (a peer read cannot be expressed)", () => {
    const port = String(SOURCES["./review.repository.ts"]);
    const methods = [...port.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]);
    expect(methods).toEqual(["listMine", "save", "deleteByMembers", "deleteBySeasons"]);
  });

  it.each([
    ["read call", "await repos.reviews.listMine(season.id, member.id)"],
    ["read call", "reviews\n  .listMine(seasonId, memberId)"],
    ["direct save", "await app.reviews.save(record, null);"],
    ["repository handle", "const rows = await repos.reviews;"],
    ["alias of reviews", "const r = repos.reviews;\nr.listMine(id);"],
    ["destructured reviews", "const { reviews } = repos;"],
    ["destructured repository method", "const { listMine } = repos.reviews;"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag review data carried on an input or another aggregate's store", () => {
    for (const source of [
      "const reviews = await listOwnReviews(deps, actor, seasonId);",
      "const { entry, reviews } = loaded.value;",
      "const own = input.reviews.filter((r) => r.periodIndex === 1);",
      "await repos.habits.get(id);",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
