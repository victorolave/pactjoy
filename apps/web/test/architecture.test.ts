import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards for the folder architecture of src (ADR-0012). Biome's `noRestrictedImports` is not used
 * here because these rules depend on WHERE the importing file lives (its own feature, or none), and
 * its patterns cannot say "any other feature, unless the target is its index.ts".
 *
 *  1. A feature is reached only through its `index.ts`, from everywhere else in src.
 *  2. Features depend on each other only along the edges of ALLOWED_FEATURE_DEPS (a one-way DAG).
 *     Any cross-feature edge that is not listed fails, so a new dependency is a deliberate edit.
 *  3. Features never import `composition` or `shell`, the layers that assemble features.
 *  4. The base layers (shared, ui, ports, adapters, context, platform) never import a feature.
 *
 * Besides `import` and `from`, the specifiers of `vi.mock`, `vi.doMock` and `vi.importActual` count.
 */

const SRC = resolve(import.meta.dirname, "..", "src");
const IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\bvi\.(?:mock|doMock|importActual)\s*(?:<[^>]*>)?\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** feature -> the features it may reach (always through their index.ts). */
const ALLOWED_FEATURE_DEPS: Readonly<Record<string, readonly string[]>> = {
  today: ["entry", "habits"],
  habits: [],
  pact: ["habits"],
  entry: [],
  auth: [],
  circle: ["onboarding"],
  onboarding: [],
  profile: ["auth", "circle"],
  "season-progress-data": [],
  "season-member": ["habits", "season-progress-data"],
  "season-week": ["season-progress-data"],
};

const BASE_LAYERS = /^(shared|ui|ports|adapters|context|platform)\//;

/** `features/today/rows/DayRow.tsx` -> { feature: "today", rest: "rows/DayRow.tsx" }. */
function featureOf(srcPath: string): { feature: string; rest: string } | null {
  const [top, feature, ...rest] = srcPath.split("/");
  return top === "features" && feature !== undefined ? { feature, rest: rest.join("/") } : null;
}

/** The rules a file breaks, given its path and import specifiers (both relative to `src`). */
function violationsOf(file: string, specifiers: readonly string[]): string[] {
  const own = featureOf(file)?.feature;
  const found: string[] = [];
  for (const spec of specifiers) {
    const target = relative(SRC, resolve(SRC, dirname(file), spec))
      .split(sep)
      .join("/");
    const into = featureOf(target);
    if (into !== null && into.feature !== own && into.rest !== "index.ts") {
      found.push(
        `${file} imports ${target}: reach "${into.feature}" through features/${into.feature}/index.ts`,
      );
    }
    if (own !== undefined && into !== null && into.feature !== own) {
      if (!ALLOWED_FEATURE_DEPS[own]?.includes(into.feature)) {
        found.push(`${file} imports ${target}: "${own}" may not depend on "${into.feature}"`);
      }
    }
    if (own !== undefined && /^(composition|shell)\//.test(target)) {
      found.push(`${file} imports ${target}: features must not import composition or shell`);
    }
    if (BASE_LAYERS.test(file) && into !== null) {
      found.push(`${file} imports ${target}: base layers sit below features and never import them`);
    }
  }
  return found;
}

describe("the folder architecture", () => {
  it("allows pact and Today to consume habits only through its public index", () => {
    expect(violationsOf("features/pact/Foo.ts", ["../habits/index.ts"])).toEqual([]);
    expect(violationsOf("features/today/Foo.ts", ["../habits/index.ts"])).toEqual([]);
    expect(violationsOf("features/habits/Foo.ts", ["../pact/index.ts"])).toHaveLength(1);
  });
  it("keeps every import inside the dependency rules", () => {
    const found = filesUnder(SRC).flatMap((path) => {
      const file = relative(SRC, path).split(sep).join("/");
      const specifiers = [...readFileSync(path, "utf8").matchAll(IMPORT)].map(
        (m) => m[1] as string,
      );
      return violationsOf(file, specifiers);
    });
    expect(found).toEqual([]);
  });

  it("reads the specifiers of vi.mock, vi.doMock and vi.importActual too", () => {
    const source = [
      'vi.mock("../entry/sheet/EntrySheet.tsx", () => ({}));',
      'vi.doMock("../entry/queries.ts");',
      'await vi.importActual<typeof import("x")>("../entry/use.ts");',
    ].join("\n");
    expect([...source.matchAll(IMPORT)].map((m) => m[1])).toEqual([
      "../entry/sheet/EntrySheet.tsx",
      "../entry/queries.ts",
      "../entry/use.ts",
    ]);
  });

  it("notices each kind of violation, so the guard cannot go quiet", () => {
    expect(violationsOf("features/today/Foo.tsx", ["../entry/sheet/EntrySheet.tsx"])).toHaveLength(
      1,
    );
    expect(violationsOf("shell/routes.tsx", ["../features/auth/login/CodeStep.tsx"])).toHaveLength(
      1,
    );
    expect(violationsOf("features/entry/Foo.tsx", ["../today/index.ts"])).toHaveLength(1);
    expect(violationsOf("features/onboarding/Foo.tsx", ["../circle/index.ts"])).toHaveLength(1);
    expect(violationsOf("features/circle/Foo.tsx", ["../profile/index.ts"])).toHaveLength(1);
    expect(
      violationsOf("features/profile/Foo.tsx", ["../circle/index.ts", "../auth/index.ts"]),
    ).toEqual([]);
    expect(violationsOf("features/circle/Foo.tsx", ["../onboarding/index.ts"])).toEqual([]);
    expect(
      violationsOf("features/entry/Foo.tsx", ["../../composition/providers.tsx"]),
    ).toHaveLength(1);
    // Base layers never reach a feature, not even through its index.
    expect(violationsOf("shared/format.ts", ["../features/today/index.ts"])).toHaveLength(1);
    expect(violationsOf("ui/Button.tsx", ["../shared/format.ts"])).toEqual([]);
    expect(
      violationsOf("features/today/Foo.tsx", ["../entry/index.ts", "./rows/DayRow.tsx"]),
    ).toEqual([]);
  });
});
