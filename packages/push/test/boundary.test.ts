import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = join(PACKAGES, "..");

/** Non-test TypeScript source under `directory`, as `[repo-relative path, text without comments]`. */
function sources(directory: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        if (name !== "node_modules") walk(path);
      } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
        found.push([relative(ROOT, path), stripComments(readFileSync(path, "utf8"))]);
      }
    }
  };
  walk(directory);
  return found;
}

/** Good enough for these files: block comments and whole-line or trailing `//` comments. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("the push boundary (ADR-0017)", () => {
  const files = sources(join(PACKAGES, "push", "src"));

  it("scans a real set of files (a walk that finds nothing cannot pass)", () => {
    expect(files.some(([path]) => path.endsWith("push/src/aes128gcm.ts"))).toBe(true);
    expect(files.some(([path]) => path.endsWith("push/src/vapid.ts"))).toBe(true);
  });

  it.each([
    ["the service-role key", /service[-_ ]?role/i],
    ["a node: import", /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']node:/],
    ["an npm: or jsr: specifier", /["'](?:npm|jsr):/],
    ["the Deno global", /\bDeno\b/],
    ["a push vendor SDK import", /["'](?:web-push|firebase|onesignal|@negrel\/|@block65\/)/i],
    ["an environment read", /\bprocess\.env\b/],
  ])("push sources contain no %s", (_name, pattern) => {
    const offenders = files.filter(([, text]) => pattern.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("the push package depends on @pactjoy/app only", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGES, "push", "package.json"), "utf8"));
    expect(Object.keys(manifest.dependencies)).toEqual(["@pactjoy/app"]);
  });

  it("no app or engine source names a push service host (the allowlist lives in the adapter)", () => {
    // Test fixtures and contract suites may carry a realistic endpoint; production code may not.
    const inner = [
      ...sources(join(PACKAGES, "app", "src")),
      ...sources(join(PACKAGES, "engine", "src")),
    ].filter(([path]) => !path.includes("/testing/") && !path.includes("/contracts/"));
    const offenders = inner
      .filter(([, text]) =>
        /push\.apple\.com|fcm\.googleapis|push\.services\.mozilla|notify\.windows/.test(text),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
