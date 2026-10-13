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

const SCANNED = ["storage/src", "app/src", "engine/src"];

describe("REQ-S3: the storage boundary", () => {
  const files = SCANNED.flatMap((dir) => sources(join(PACKAGES, dir)));

  it("scans a real set of files (a walk that finds nothing cannot pass)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(([path]) => path.endsWith("storage/src/sigv4.ts"))).toBe(true);
    expect(files.some(([path]) => path.endsWith("app/src/ports/evidence-storage.ts"))).toBe(true);
  });

  it.each([
    ["the service-role key", /service[-_ ]?role/i],
    ["a node: import", /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']node:/],
    ["an npm: or jsr: specifier", /["'](?:npm|jsr):/],
    ["the Deno global", /\bDeno\b/],
    ["a vendor SDK import", /["'](?:@supabase\/|@aws-sdk\/|aws-sdk|minio|postgres)["'/]/],
  ])("storage, app and engine sources contain no %s", (_name, pattern) => {
    const offenders = files.filter(([, text]) => pattern.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("the storage package depends on @pactjoy/app only", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGES, "storage", "package.json"), "utf8"));
    expect(Object.keys(manifest.dependencies)).toEqual(["@pactjoy/app"]);
  });
});

/** Lines of the TOML table `[name]`, comments removed. */
function table(toml: string, name: string): string[] {
  const lines = toml.split("\n").map((line) => line.replace(/#.*$/, "").trim());
  const start = lines.indexOf(`[${name}]`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("["));
  return (end < 0 ? rest : rest.slice(0, end)).filter((line) => line !== "");
}

describe("REQ-S4: supabase/config.toml storage", () => {
  const toml = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");

  it("enables the S3 protocol", () => {
    expect(table(toml, "storage.s3_protocol")).toEqual(["enabled = true"]);
  });

  it("declares the private entry-photos bucket with the size and type limits", () => {
    expect(table(toml, "storage.buckets.entry-photos")).toEqual([
      "public = false",
      'file_size_limit = "3MiB"',
      'allowed_mime_types = ["image/jpeg"]',
    ]);
  });

  it("repeats MAX_PHOTO_BYTES (3 MiB) from the app limits", () => {
    const limits = readFileSync(join(PACKAGES, "app", "src", "entry-photo", "limits.ts"), "utf8");
    expect(limits).toContain("MAX_PHOTO_BYTES = 3 * 1024 * 1024");
  });

  it("holds no key or secret", () => {
    const uncommented = toml
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    expect(uncommented).not.toMatch(/access[-_]?key|secret|service[-_]?role|password/i);
  });
});
