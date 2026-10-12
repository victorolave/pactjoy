import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The persisted state of a Pause request is NOT what a reader may act on: a
 * pending request turns approved at its deadline with no job having run
 * (ADR-0013). So `pauses.listBySeason` / `pauses.listDue` may only be called
 * from `src/pause/` (the choke point and the settle/use-case code beside it)
 * and from the adapter contract suites that exercise the port itself.
 */
const ALLOWED = [/^\.\/(?!\.)/, /^\.\.\/contracts\//];
const FORBIDDEN_CALL = /\bpauses\s*\.\s*(listBySeason|listDue)\b/;

describe("pauses are read through the choke point only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain("./effective-pauses.ts");
  });

  it("no file outside src/pause calls pauses.listBySeason or pauses.listDue", () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !ALLOWED.some((allowed) => allowed.test(path)))
      .filter(([, source]) => FORBIDDEN_CALL.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("the pattern does catch a direct read (guards the guard)", () => {
    expect(FORBIDDEN_CALL.test("await repos.pauses.listBySeason(season.id)")).toBe(true);
    expect(FORBIDDEN_CALL.test("pauses\n  .listDue(now)")).toBe(true);
    expect(FORBIDDEN_CALL.test("loadEffectivePauses(repos, context)")).toBe(false);
  });
});
