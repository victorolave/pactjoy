import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The join-attempt counters (ADR-0020) are written by `src/rate-limit/` only: the store is
 * `repos.rateLimits` / the `RateLimitRepository` type, and only this module (the use case, the
 * erasure helper and the test seed) and the adapter contract suites may touch it. Anyone else
 * calls `admitJoinAttempt` or `eraseUserRateLimits`. The type alone is also wired by the
 * composition files in `REPOSITORY_TYPE_HOMES`.
 */
const ALLOWED = [/^\.\/(?!\.)/, /^\.\.\/contracts\//];
const REPOSITORY_TYPE_HOMES = [
  /^\.\.\/ports\/repositories\.ts$/,
  /^\.\.\/index\.ts$/,
  /^\.\.\/testing\//,
];

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "repository handle", pattern: /\b(repos|tx|uow|app)\s*\.\s*rateLimits\b/ },
  { name: "alias of rateLimits", pattern: /=\s*[\w.?]*\.rateLimits\s*[;,)\n]/ },
  {
    name: "destructured rateLimits",
    pattern: /\{[^}]*\brateLimits\b[^}]*\}\s*(=\s*(repos|app|tx|uow)\b|\)\s*=>)/,
  },
  { name: "counter call", pattern: /\brateLimits\s*\.\s*(hit|sweepExpired|deleteBySubjects)\s*\(/ },
];
const REPOSITORY_TYPE = /\bRateLimitRepository\b/;

const outside = (allowed: readonly RegExp[]) =>
  Object.entries(SOURCES).filter(([path]) => !allowed.some((a) => a.test(path)));

describe("rate-limit counters are touched inside the rate-limit module only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain("./rate-limit.repository.ts");
  });

  it("no file outside src/rate-limit reaches the counter repository", () => {
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
    ["repository handle", "await repos.rateLimits.hit(counters)"],
    ["alias of rateLimits", "const r = repos.rateLimits;\nr.hit(c);"],
    ["destructured rateLimits", "app.uow.transaction(async ({ rateLimits }) => ok(1))"],
    ["counter call", "rateLimits\n  .deleteBySubjects([s])"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag the use cases that wrap the counters", () => {
    for (const source of [
      "const admitted = await admitJoinAttempt(deps, actor, input);",
      "await eraseUserRateLimits(repos, userId);",
      "await repos.habits.get(id);",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
