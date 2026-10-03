import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "AppShell.module.css"), "utf8");
const block = (selector: string): string =>
  new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

describe("the shell's top spacing", () => {
  it("keeps clear of the iPhone's top inset", () => {
    expect(block("shell")).toContain("padding-top: var(--safe-top)");
  });

  it("adds a design-scale gap before the date and greeting, from a spacing token", () => {
    // Design 15a puts 8 px under the status bar; in a browser there is no inset, so 8 sat flush.
    const padding = /padding:\s*var\(--space-(\d)\)/.exec(block("content"));
    expect(padding).not.toBeNull();
    expect(Number(padding?.[1])).toBeGreaterThanOrEqual(4);
  });
});
