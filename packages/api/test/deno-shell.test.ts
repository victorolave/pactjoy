import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Supabase Edge shell is the only Deno-aware code (ADR-0011). It is type-checked in CI by the
// `deno` job; these scans pin its shape so it cannot grow into a second place for logic.
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const FUNCTION_DIR = join(REPO_ROOT, "supabase", "functions", "api");
const ENTRY = join(FUNCTION_DIR, "index.ts");
const DENO_JSON = join(FUNCTION_DIR, "deno.json");

const read = (path: string) => readFileSync(path, "utf8");
const codeLines = (text: string) =>
  text.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("//"));

describe("Deno shell (supabase/functions/api)", () => {
  it("DE-S2: the entry is composition only: no routing, no Response, at most 40 code lines", () => {
    const text = read(ENTRY);
    expect(codeLines(text).length).toBeLessThanOrEqual(40);
    expect(text).not.toMatch(/\bswitch\b|\bpathname\b|new Response\b/);
    expect(text).toContain("Deno.serve(");
  });

  it("DE-S3: the entry imports only @pactjoy/* packages (vendors go through the import map)", () => {
    const specifiers = [...read(ENTRY).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !s?.startsWith("@pactjoy/"))).toEqual([]);
  });

  it("DE-S4: the import map points at existing package sources", () => {
    const map = JSON.parse(read(DENO_JSON)).imports as Record<string, string>;
    const local = Object.entries(map).filter(([name]) => name.startsWith("@pactjoy/"));
    expect(local.map(([name]) => name).sort()).toEqual([
      "@pactjoy/api",
      "@pactjoy/app",
      "@pactjoy/db",
      "@pactjoy/engine",
    ]);
    for (const [, target] of local) {
      expect(existsSync(resolve(dirname(DENO_JSON), target))).toBe(true);
    }
  });

  it("DE-S4: npm: versions are exactly the ones pinned in pnpm-lock.yaml", () => {
    const map = JSON.parse(read(DENO_JSON)).imports as Record<string, string>;
    const lock = read(join(REPO_ROOT, "pnpm-lock.yaml"));
    for (const name of ["postgres", "jose"]) {
      const match = /^npm:([^@]+)@(.+)$/.exec(map[name] ?? "");
      expect(match?.[1]).toBe(name);
      expect(lock).toMatch(new RegExp(`^ {2}${name}@${match?.[2]?.replace(/\./g, "\\.")}:`, "m"));
    }
  });
});
