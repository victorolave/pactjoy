import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The persisted state of a Pause request is NOT what a reader may act on: a
 * pending request turns approved at its deadline with no job having run
 * (ADR-0013). So the repository (`repos.pauses`, its `listBySeason` /
 * `listDue` / `get`, or the `PauseRequestRepository` type) may only be touched
 * from `src/pause/` (the choke point and the settle/use-case code beside it)
 * and from the adapter contract suites that exercise the port itself. The
 * type alone is also wired by the composition files in `REPOSITORY_TYPE_HOMES`.
 * There is no separate read-only reader port: `loadEffectivePauses` is it.
 */
const ALLOWED = [
  /^\.\/(?!\.)/,
  /^\.\.\/contracts\//,
  // Asserts the PERSISTED outcome of PL-9 (settle on leave); it is a test of storage, not a reader.
  /^\.\.\/circle\/leave-circle-pauses\.test\.ts$/,
];
const REPOSITORY_TYPE_HOMES = [
  /^\.\.\/ports\/repositories\.ts$/,
  /^\.\.\/index\.ts$/,
  /^\.\.\/testing\//,
];

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "list call", pattern: /\bpauses\s*\.\s*(listBySeason|listDue)\b/ },
  { name: "direct get", pattern: /\.\s*pauses\s*\.\s*get\s*\(/ },
  // Erasure goes through `pause/erase.ts` (`dropSeasonPauses`), never a bare repository call.
  { name: "season delete", pattern: /\bpauses\s*\.\s*deleteBySeasons\b/ },
  { name: "repository handle", pattern: /\b(repos|tx|uow)\s*\.\s*pauses\b/ },
  { name: "alias of pauses", pattern: /=\s*[\w.?]*\.pauses\s*[;,)\n]/ },
  {
    name: "destructured pauses",
    pattern: /\{[^}]*\bpauses\b[^}]*\}\s*=\s*(repos|app|tx|uow)\b/,
  },
  {
    name: "destructured repository method",
    pattern: /\{[^}]*\b(listBySeason|listDue|get)\b[^}]*\}\s*=\s*[\w.?]*\bpauses\b/,
  },
];
const REPOSITORY_TYPE = /\bPauseRequest(Repository|Reader)\b/;

const outside = (allowed: readonly RegExp[]) =>
  Object.entries(SOURCES).filter(([path]) => !allowed.some((a) => a.test(path)));

describe("pauses are read through the choke point only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain("./effective-pauses.ts");
  });

  it("no file outside src/pause reaches the Pause repository", () => {
    const offenders = outside(ALLOWED).flatMap(([path, source]) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(String(source))).map(
        ({ name }) => `${path}: ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("only the composition files name the repository (or reader) type", () => {
    const offenders = outside([...ALLOWED, ...REPOSITORY_TYPE_HOMES])
      .filter(([, source]) => REPOSITORY_TYPE.test(String(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it.each([
    ["list call", "await repos.pauses.listBySeason(season.id)"],
    ["list call", "pauses\n  .listDue(now)"],
    ["direct get", "const stored = await app.pauses.get(id);"],
    ["season delete", "await repos.pauses.deleteBySeasons(seasonIds);"],
    ["repository handle", "const rows = await repos.pauses;"],
    ["alias of pauses", "const p = repos.pauses;\np.listBySeason(id);"],
    ["destructured pauses", "const { pauses } = repos;"],
    ["destructured repository method", "const { listBySeason } = repos.pauses;"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag the choke point or effective pauses carried on an input", () => {
    for (const source of [
      "loadEffectivePauses(repos, context)",
      "const { entry, pauses } = loaded.value;",
      "const ownPauses = input.pauses.filter((p) => p.commitmentId === id);",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
