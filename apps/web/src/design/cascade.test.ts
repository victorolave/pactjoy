import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

/**
 * The vendored design system must lose to the app's own CSS whatever order the bundler emits them
 * in. Unlayered rules (every CSS module) always beat layered ones, so putting all vendor CSS in a
 * `vendor` layer makes `.success` on a card override `.pj-card` by construction, not by luck.
 */
describe("the vendored CSS lives in its own layer", () => {
  const index = read("./index.css");

  it("declares the layer before importing anything", () => {
    const declaration = index.indexOf("@layer vendor");
    const firstImport = index.indexOf("@import");
    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(declaration).toBeLessThan(firstImport);
  });

  it("imports every vendored stylesheet into that layer, and nothing vendored outside it", () => {
    const files = readdirSync(join(import.meta.dirname, "vendor")).filter((name) =>
      name.endsWith(".css"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(index).toMatch(new RegExp(`@import "\\./vendor/${file}" layer\\(vendor\\);`));
    }
    const vendorImports = index.match(/@import "\.\/vendor\/[^"]+"[^;]*;/g) ?? [];
    expect(vendorImports.every((line) => line.includes("layer(vendor)"))).toBe(true);
  });

  it("keeps app-only tokens outside the layer, so they can override the vendored ones", () => {
    expect(index).toMatch(/@import "\.\/local-tokens\.css";/);
  });
});
