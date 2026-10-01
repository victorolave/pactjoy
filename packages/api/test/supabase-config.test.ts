import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// supabase/config.toml is deliberately minimal (pinned values only; some restate CLI defaults) and
// the owner applies it to the hosted project with `supabase config push` (ADR-0011, Q4).
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SUPABASE = join(REPO_ROOT, "supabase");
const CONFIG = join(SUPABASE, "config.toml");
const FUNCTIONS = join(SUPABASE, "functions");

const read = (path: string) => readFileSync(path, "utf8");

type Section = Record<string, string>;

// Just enough TOML for this file: `[section]` headers and `key = value` lines (values kept raw).
function parseToml(text: string): Record<string, Section> {
  const sections: Record<string, Section> = { "": {} };
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1] ?? "";
      sections[current] ??= {};
      continue;
    }
    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) throw new Error(`unparseable TOML line: ${raw}`);
    (sections[current] as Section)[pair[1] ?? ""] = (pair[2] ?? "").trim();
  }
  return sections;
}

const listed = (value: string | undefined) =>
  [...(value ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const config = () => parseToml(read(CONFIG));

describe("supabase/config.toml", () => {
  it("DE-S5: exists, parses and pins the project, Postgres major and the local auth shape", () => {
    expect(existsSync(CONFIG)).toBe(true);
    const c = config();
    expect(c[""]?.project_id).toBe('"pactjoy"');
    expect(c.db?.major_version).toBe("17");
    expect(c["auth.email"]?.otp_length).toBe("6");
    // Q6 (open vs invite-only signup) is the owner's call: only the key shape is pinned.
    expect(c["auth.email"]?.enable_signup).toMatch(/^(true|false)$/);
  });

  it("DE-S6: the Data API never exposes the pactjoy schema (ADR-0010)", () => {
    const api = config().api ?? {};
    expect(listed(api.schemas)).toEqual(["public", "graphql_public"]);
    expect(listed(api.extra_search_path)).not.toContain("pactjoy");
  });

  it("DE-S7: the api function verifies the JWT in code and uses the deno.json import map", () => {
    const fn = config()["functions.api"] ?? {};
    expect(fn.verify_jwt).toBe("false");
    expect(fn.import_map).toBe('"./functions/api/deno.json"');
    expect(existsSync(resolve(SUPABASE, "functions", "api", "deno.json"))).toBe(true);
  });

  it("the magic-link template exists, carries the OTP token and no link", () => {
    const template = config()["auth.email.template.magic_link"] ?? {};
    expect(template.content_path).toBe('"./supabase/templates/otp.html"');
    const html = read(join(SUPABASE, "templates", "otp.html"));
    expect(html).toContain("{{ .Token }}");
    expect(html).not.toContain("ConfirmationURL");
  });

  it("DE-S8, AU-S16: no service-role key or JWT-looking secret in the config or the function", () => {
    const scanned = [CONFIG, ...files(FUNCTIONS)];
    const offenders = scanned.flatMap((file) => {
      const text = read(file);
      const found: string[] = [];
      if (/service[_-]?role/i.test(text)) found.push("service role");
      if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(text)) found.push("JWT-like string");
      return found.map((what) => `${file.slice(REPO_ROOT.length + 1)}: ${what}`);
    });
    expect(offenders).toEqual([]);
  });

  it("the function sources use no Deno-only vendor specifier outside the import map", () => {
    const offenders = files(FUNCTIONS)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) => {
        const text = read(file);
        return /["'`](npm:|jsr:|https?:\/\/deno\.land)/.test(text) ? [file] : [];
      });
    expect(offenders).toEqual([]);
  });

  it("the local signing key is gitignored (it is a secret)", () => {
    expect(read(join(REPO_ROOT, ".gitignore"))).toMatch(/^supabase\/signing_keys\.json$/m);
  });

  it("config.toml stays within the subset the in-test TOML reader supports", () => {
    const offenders = read(CONFIG)
      .split("\n")
      .filter((raw) => {
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || /^\[[^\]]+\]$/.test(line)) return false;
        const value = (/^[A-Za-z0-9_.-]+\s*=\s*(.*)$/.exec(line)?.[1] ?? "").trim();
        const unbalanced = (value.match(/\[/g)?.length ?? 0) !== (value.match(/\]/g)?.length ?? 0);
        const badQuotes = (value.match(/"/g)?.length ?? 0) % 2 !== 0 || value.includes('"""');
        const inlineComment = value.replace(/"[^"]*"/g, "").includes("#");
        return value === "" || unbalanced || badQuotes || inlineComment;
      });
    expect(offenders).toEqual([]);
  });

  it("the TOML reader and its list helper behave on the shapes used here", () => {
    const parsed = parseToml('a = 1\n# c\n[x.y]\nk = "v"\nl = ["a", "b"]');
    expect(parsed[""]?.a).toBe("1");
    expect(parsed["x.y"]?.k).toBe('"v"');
    expect(listed(parsed["x.y"]?.l)).toEqual(["a", "b"]);
    expect(() => parseToml("not toml")).toThrow();
  });
});
