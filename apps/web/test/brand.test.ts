import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** The brand files are vendored from Claude Design: they must stay plain, safe vector art. */

const BRAND = resolve(import.meta.dirname, "../src/design/brand");
const svgs = readdirSync(BRAND).filter((name) => name.endsWith(".svg"));

describe("illustrations", () => {
  const names = ["cocinar", "registro-guardado", "sin-conexion"];

  it.each(names)("%s.webp is a real WebP image", (name) => {
    const bytes = readFileSync(join(BRAND, `${name}.webp`));
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(bytes.length).toBeLessThan(100 * 1024);
  });
});

describe("brand SVGs", () => {
  it("has the official horizontal logo and the symbol", () => {
    expect(svgs.sort()).toEqual(["pactjoy-horizontal-proposed.svg", "pactjoy-symbol-gradient.svg"]);
  });

  it.each(svgs)("%s is a well-formed SVG named PactJoy", (name) => {
    const text = readFileSync(join(BRAND, name), "utf8");
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.tagName).toBe("svg");
    expect(doc.documentElement.getAttribute("aria-label")).toBe("PactJoy");
  });

  it.each(svgs)("%s carries no script, event handler or external reference", (name) => {
    const text = readFileSync(join(BRAND, name), "utf8");
    expect(text).not.toMatch(/<script|\son\w+=|javascript:|<foreignObject|<image|href="https?:/i);
  });

  it("states that the files are not under the AGPL", () => {
    const readme = readFileSync(join(BRAND, "README.md"), "utf8");
    expect(readme).toContain("Not covered by the AGPL");
    expect(readme).toContain("TRADEMARKS.md");
  });
});
