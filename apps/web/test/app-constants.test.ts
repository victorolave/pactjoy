import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(import.meta.dirname, "..", "..", "..", "packages", "app", "src");
const read = (file: string) => readFileSync(join(APP, file), "utf8");

/**
 * The pause grace extension (B7) is zero until A2. It must have ONE home, `entry-window.ts`, so the
 * entry window, Today's rows and the De ayer items cannot drift apart when A2 wires it.
 */
describe("PAUSE_GRACE_EXTENSION_DAYS has one home", () => {
  it.each([
    "today/today-rows.ts",
    "today/pending-yesterday.ts",
    "entry/own-entry.ts",
    "entry/record-entry.ts",
  ])("%s reads it from entry-window.ts instead of repeating a literal", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/pauseGraceExtensionDays:\s*0\b/);
    expect(source).not.toMatch(/const PAUSE_GRACE_EXTENSION_DAYS\s*=/);
    expect(source).toContain("PAUSE_GRACE_EXTENSION_DAYS");
  });

  it("is defined exactly once", () => {
    expect(read("entry/entry-window.ts")).toMatch(/export const PAUSE_GRACE_EXTENSION_DAYS = 0;/);
  });
});
