import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards for the vendored design system (ADR-0012): the vendored CSS is a verbatim copy that
 * must not drift, and app code must take every colour and length from a token.
 */

const WEB_ROOT = resolve(import.meta.dirname, "..");
const SRC = join(WEB_ROOT, "src");
const VENDOR = join(SRC, "design", "vendor");
const PROJECT_ID = "239122e1-7217-4b6b-ac98-3383f1876fc6";

/** The header every vendored file starts with; the hashed body begins after it. */
const HEADER = /^\/\* VENDORED FILE[\s\S]*?\*\/\n\n/;

interface Manifest {
  readonly source: { readonly projectId: string; readonly folder: string };
  readonly vendoredOn: string;
  readonly files: Readonly<Record<string, string>>;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function filesUnder(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const PX = /\b\d+(?:\.\d+)?px\b/;

/** In CSS any occurrence counts; in TS/TSX only string literals can carry a value. */
function literalValues(source: string, kind: "css" | "ts"): string[] {
  const scope =
    kind === "css"
      ? [source.replace(/\/\*[\s\S]*?\*\//g, "")]
      : (source.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? []);
  return scope.flatMap((chunk) => {
    const found = [HEX.exec(chunk)?.[0], PX.exec(chunk)?.[0]];
    return found.filter((value): value is string => value !== undefined);
  });
}

describe("literalValues (the scanner itself)", () => {
  it("finds hex colours and px lengths in CSS, ignoring comments", () => {
    expect(literalValues("a{color:#FFAD33;margin:4px}", "css")).toEqual(["#FFAD33", "4px"]);
    expect(literalValues("/* #FFF 4px */ a{margin:var(--space-1)}", "css")).toEqual([]);
  });

  it("finds them in TS string literals only", () => {
    expect(literalValues('const c = "#FF6252"; const w = `8px`;', "ts")).toEqual([
      "#FF6252",
      "8px",
    ]);
    expect(literalValues('style={{ width: "12px" }}', "ts")).toEqual(["12px"]);
    expect(literalValues("const items = [1, 2]; // 4px in a comment", "ts")).toEqual([]);
  });

  it("does not mistake an anchor or an id for a colour", () => {
    expect(literalValues('href="#main-content"', "ts")).toEqual([]);
  });
});

describe("vendored design-system CSS", () => {
  const manifestPath = join(VENDOR, "MANIFEST.json");
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  it("records where it came from", () => {
    expect(manifest.source.projectId).toBe(PROJECT_ID);
    expect(manifest.source.folder).toMatch(/^_ds\/pactjoy-design-system-[0-9a-f-]+$/);
    expect(manifest.vendoredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lists exactly the CSS files in vendor/", () => {
    const onDisk = readdirSync(VENDOR)
      .filter((name) => name.endsWith(".css"))
      .sort();
    expect(Object.keys(manifest.files).sort()).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(manifest.files))(
    "%s matches its sha256 and has a provenance header",
    (name, hash) => {
      const text = readFileSync(join(VENDOR, name), "utf8");
      const header = HEADER.exec(text)?.[0] ?? "";
      expect(header).toContain(PROJECT_ID);
      expect(header).toContain("TRADEMARKS.md");
      expect(sha256(text.slice(header.length))).toBe(hash);
    },
  );
});

describe("app code uses tokens, never raw colours or lengths", () => {
  const allowed = (file: string) =>
    file.startsWith(VENDOR) || file === join(SRC, "design", "local-tokens.css");
  const cssFiles = filesUnder(SRC, /\.css$/).filter((file) => !allowed(file));
  const tsFiles = filesUnder(SRC, /\.(ts|tsx)$/).filter((file) => !/\.test\.tsx?$/.test(file));

  it("scans the real files that exist", () => {
    expect(cssFiles.length + tsFiles.length).toBeGreaterThan(0);
  });

  it("has no hex colour or px length outside the vendor folder and local-tokens.css", () => {
    const offenders = [
      ...cssFiles.flatMap((file) =>
        literalValues(readFileSync(file, "utf8"), "css").map(
          (v) => `${relative(WEB_ROOT, file)}: ${v}`,
        ),
      ),
      ...tsFiles.flatMap((file) =>
        literalValues(readFileSync(file, "utf8"), "ts").map(
          (v) => `${relative(WEB_ROOT, file)}: ${v}`,
        ),
      ),
    ];
    expect(offenders).toEqual([]);
  });
});

describe("fonts", () => {
  it("come from @fontsource/nunito-sans, which ships the SIL OFL license", () => {
    const license = readFileSync(
      join(WEB_ROOT, "node_modules", "@fontsource", "nunito-sans", "LICENSE"),
      "utf8",
    );
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    const fonts = readFileSync(join(SRC, "design", "fonts.ts"), "utf8");
    for (const weight of ["400", "600", "700", "800"]) {
      expect(fonts).toContain(`@fontsource/nunito-sans/${weight}.css`);
    }
  });
});
