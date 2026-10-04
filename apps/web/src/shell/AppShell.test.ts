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

describe("the shell's width", () => {
  it("caps the column at the app max-width token and centres it", () => {
    expect(block("shell")).toContain("max-width: var(--app-max-width)");
    expect(block("shell")).toContain("margin-inline: auto");
  });

  it("defines the token at the iPhone-first 480 px", () => {
    const tokens = readFileSync(join(import.meta.dirname, "../design/local-tokens.css"), "utf8");
    expect(tokens).toContain("--app-max-width: 480px");
  });

  it("caps the toasts and the bottom sheets to the same column", () => {
    for (const file of ["../context/toast-context.module.css", "../ui/Sheet.module.css"]) {
      const other = readFileSync(join(import.meta.dirname, file), "utf8");
      expect(other).toContain("max-width");
      expect(other).toContain("--app-max-width");
      expect(other).toContain("margin-inline: auto");
    }
  });
});
