import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The primitives style themselves with the vendored design-system classes (`pj-*`). A typo would
 * silently unstyle a component, so every `pj-*` class the UI names must exist in the vendored CSS.
 */

const WEB_ROOT = resolve(import.meta.dirname, "..");
const UI = join(WEB_ROOT, "src");
const VENDOR_CSS = readFileSync(join(WEB_ROOT, "src/design/vendor/components.css"), "utf8");

const sources = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === "vendor" ? [] : sources(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      })
    : [];

const CLASS_IN_SOURCE = /(?<![-\w])pj-[a-z0-9]+(?:(?:__|--)[a-z0-9-]+)*/g;
const defined = (name: string) => new RegExp(`\\.${name}(?![\\w-])`).test(VENDOR_CSS);

describe("design-system class names used by the UI", () => {
  const files = sources(UI);

  it("scans real source files that use pj-* classes", () => {
    const used = files.flatMap((file) => readFileSync(file, "utf8").match(CLASS_IN_SOURCE) ?? []);
    expect(used.length).toBeGreaterThan(10);
  });

  it("only names classes that the vendored components.css defines", () => {
    const missing = files.flatMap((file) =>
      [...new Set(readFileSync(file, "utf8").match(CLASS_IN_SOURCE) ?? [])]
        .filter((name) => !defined(name))
        .map((name) => `${file.slice(WEB_ROOT.length + 1)}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it("does not mistake a custom property for a class", () => {
    expect("color: var(--pj-ink); gap: var(--space-2)".match(CLASS_IN_SOURCE)).toBeNull();
    expect('className="pj-btn pj-btn--sm"'.match(CLASS_IN_SOURCE)).toEqual([
      "pj-btn",
      "pj-btn--sm",
    ]);
  });

  it("knows what a defined and an undefined class look like (scanner check)", () => {
    expect(defined("pj-btn")).toBe(true);
    expect(defined("pj-btn--primary")).toBe(true);
    expect(defined("pj-button")).toBe(false);
    expect(defined("pj-btn--prim")).toBe(false);
  });
});
