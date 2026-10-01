import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = resolve(import.meta.dirname, "..");
const SRC = join(API_ROOT, "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : [];
  });
}

const rel = (file: string) => relative(API_ROOT, file);

// Static, side-effect, dynamic and CommonJS imports of a bare specifier or its subpaths.
const importsModule = (text: string, name: string) =>
  new RegExp(`(?:\\bfrom|\\bimport|\\brequire)\\s*\\(?\\s*["'\`]${name}(?:/[^"'\`]*)?["'\`]`).test(
    text,
  );

// Relative specifiers in static and dynamic imports and re-exports.
const relativeSpecifiers = (text: string) =>
  [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'`](\.{1,2}\/[^"'`]*)["'`]/g)].map(
    (m) => m[1] ?? "",
  );

const testDoubleImports = (text: string) => [
  ...relativeSpecifiers(text).filter((s) => /(^|\/)testing(\/|$)/.test(s)),
  ...(importsModule(text, "@pactjoy/api/testing") ? ["@pactjoy/api/testing"] : []),
  ...(importsModule(text, "@pactjoy/app/testing") ? ["@pactjoy/app/testing"] : []),
  ...(importsModule(text, "@pactjoy/app/contracts") ? ["@pactjoy/app/contracts"] : []),
];

describe("package boundary", () => {
  it("the public surface is exactly the design's runtime exports (ADR-0011)", async () => {
    const index = await import("../src/index.ts");
    expect(Object.keys(index).sort()).toEqual([
      "createApi",
      "createConsoleLogger",
      "createJwksTokenVerifier",
      "createLazyHandler",
      "describeEnvError",
      "loadApiEnv",
    ]);
  });

  it("AC-S2, AU-S16: src never touches the driver, Deno specifiers, the db package or secrets", () => {
    const forbidden: Array<[string, (text: string) => boolean]> = [
      ["postgres", (t) => importsModule(t, "postgres")],
      ["@pactjoy/db", (t) => importsModule(t, "@pactjoy/db")],
      ["npm: specifier", (t) => /["'`]npm:/.test(t)],
      ["jsr: specifier", (t) => /["'`]jsr:/.test(t)],
      ["node: specifier", (t) => /["'`]node:/.test(t)],
      ["Deno global", (t) => /\bDeno\./.test(t)],
      ["service role", (t) => /service[_-]?role/i.test(t)],
    ];
    const offenders = sources(SRC).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return forbidden.filter(([, found]) => found(text)).map(([what]) => `${rel(file)}: ${what}`);
    });
    expect(offenders).toEqual([]);
  });

  it("AU-S16: jose is imported by src/adapters/jose-token-verifier.ts and nowhere else", () => {
    const importers = sources(SRC)
      .filter((file) => importsModule(readFileSync(file, "utf8"), "jose"))
      .map(rel);
    expect(importers).toEqual(["src/adapters/jose-token-verifier.ts"]);
  });

  it("production src never imports test doubles (src/testing, @pactjoy/api/testing, @pactjoy/app/testing, contracts)", () => {
    const offenders = sources(SRC)
      .filter((file) => !rel(file).startsWith(join("src", "testing")))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        const bad = testDoubleImports(text);
        return bad.map((specifier) => `${rel(file)}: ${specifier}`);
      });
    expect(offenders).toEqual([]);
  });

  it("DE-S3: every relative import in src ends in .ts (ADR-0007)", () => {
    const offenders = sources(SRC).flatMap((file) =>
      relativeSpecifiers(readFileSync(file, "utf8"))
        .filter((specifier) => !specifier.endsWith(".ts"))
        .map((specifier) => `${rel(file)}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the scanners themselves catch every import form", () => {
    for (const code of [
      'import { x } from "jose";',
      'import "jose/jwks";',
      'const m = await import("jose");',
      "const m = await import(`jose`);",
      'const m = require("jose");',
    ])
      expect(importsModule(code, "jose"), code).toBe(true);
    for (const code of ['import x from "jose-other";', 'import x from "./jose.ts";'])
      expect(importsModule(code, "jose"), code).toBe(false);
    expect(testDoubleImports('import { x } from "@pactjoy/api/testing";')).toEqual([
      "@pactjoy/api/testing",
    ]);
    expect(relativeSpecifiers('import a from "./a";\nexport * from "../b.ts";')).toEqual([
      "./a",
      "../b.ts",
    ]);
  });
});
