import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard tests for the rules Biome cannot express (ADR-0012): Biome 2.5 has no type-only import
 * option, and `noRestrictedGlobals` does not see `globalThis.fetch` or `window.localStorage`.
 */

const WEB_ROOT = resolve(import.meta.dirname, "..");

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : [];
  });
}

const files = [...sources(join(WEB_ROOT, "src")), ...sources(join(WEB_ROOT, "scripts"))];
const rel = (file: string) => relative(WEB_ROOT, file);

const SPECIFIER = `["'\`]@pactjoy\\/[^"'\`]*["'\`]`;
const STATEMENTS = [
  // import ... from "@pactjoy/x" and export ... from "@pactjoy/x" (multi-line safe)
  new RegExp(`\\b(?:import|export)\\b[^;"'\`]*?\\bfrom\\s*${SPECIFIER}`, "g"),
  // import "@pactjoy/x" (side effect)
  new RegExp(`\\bimport\\s*${SPECIFIER}`, "g"),
  // import("@pactjoy/x") and require("@pactjoy/x")
  new RegExp(`\\b(?:import|require)\\s*\\(\\s*${SPECIFIER}\\s*\\)`, "g"),
];
const ALLOWED = /^import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s*["']@pactjoy\/app["']$/s;

/** Every statement that touches a `@pactjoy/*` module and is NOT `import type ... from "@pactjoy/app"`. */
function pactjoyViolations(text: string): string[] {
  return STATEMENTS.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0])).filter(
    (statement) => !ALLOWED.test(statement),
  );
}

const GLOBAL_ACCESS =
  /\b(?:globalThis|window|self)\s*\.\s*(?:fetch|localStorage|sessionStorage|indexedDB|navigator)\b/;
const GLOBAL_ALLOWED = /^src\/adapters\/|^src\/main\.tsx$/;

describe("pactjoyViolations (the scanner itself)", () => {
  it.each([
    'import type { TodayView } from "@pactjoy/app";',
    'import type * as App from "@pactjoy/app";',
    'import type {\n  TodayView,\n  TodayRow,\n} from "@pactjoy/app";',
  ])("accepts a type-only import from the app root: %s", (code) => {
    expect(pactjoyViolations(code)).toEqual([]);
  });

  it.each([
    ['import { type TodayView, today } from "@pactjoy/app";', "mixed value import"],
    ['import { type TodayView } from "@pactjoy/app";', "inline type modifier only"],
    ['import { today } from "@pactjoy/app";', "value import"],
    ['import type { X } from "@pactjoy/api";', "type import from another package"],
    ['import type { X } from "@pactjoy/app/testing";', "type import from a subpath"],
    ['export { today } from "@pactjoy/app";', "value re-export"],
    ['export type { TodayView } from "@pactjoy/app";', "type re-export"],
    ['export * from "@pactjoy/app";', "star re-export"],
    ['const app = await import("@pactjoy/app");', "dynamic import"],
    ['const app = require("@pactjoy/app");', "require"],
    ['import "@pactjoy/app";', "side-effect import"],
  ])("rejects %s (%s)", (code) => {
    expect(pactjoyViolations(code)).toHaveLength(1);
  });

  it("ignores prose that mentions the package", () => {
    expect(pactjoyViolations("// type-only from `@pactjoy/app` (ADR-0012)")).toEqual([]);
  });
});

describe("apps/web boundaries", () => {
  it("scans real files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every @pactjoy import or re-export is `import type ... from "@pactjoy/app"`', () => {
    const offenders = files.flatMap((file) =>
      pactjoyViolations(readFileSync(file, "utf8")).map(
        (statement) => `${rel(file)}: ${statement}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("global fetch and browser storage are reached only from src/adapters and src/main.tsx", () => {
    const offenders = files
      .filter((file) => !GLOBAL_ALLOWED.test(rel(file)))
      .filter((file) => GLOBAL_ACCESS.test(readFileSync(file, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("import.meta.env is read only by src/config.ts", () => {
    const offenders = files
      .filter((file) => rel(file) !== "src/config.ts")
      .filter((file) => /import\.meta\.env/.test(readFileSync(file, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("the global access rule (scanner check)", () => {
  it.each([
    "globalThis.fetch(url)",
    "window.fetch(url)",
    "window.localStorage.getItem('a')",
    "self.navigator.onLine",
  ])("flags %s", (code) => {
    expect(GLOBAL_ACCESS.test(code)).toBe(true);
  });

  it("does not flag a parameter named fetch", () => {
    expect(GLOBAL_ACCESS.test("this.#options.fetch(url)")).toBe(false);
  });
});
