import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Motion guard for the season results (design 36): the Together ribbon draws once, within the
 * celebrate token (700 ms), and nothing moves under reduced motion. No confetti over numbers.
 */
const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
const css = read("season-close.module.css");
const motion = read("../../design/vendor/motion.css");

describe("the results ribbon", () => {
  it("draws once with the celebrate token and only that animation exists", () => {
    expect(css).toMatch(
      /\.ribbon\s*\{[^}]*animation:\s*ribbon-draw var\(--motion-celebrate\)[^}]*both;/,
    );
    expect(css).not.toMatch(/animation-iteration-count|infinite/);
    expect([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])).toEqual(["ribbon-draw"]);
  });

  it("is within 700 ms, and the token is 0 under reduced motion", () => {
    expect(motion).toMatch(/--motion-celebrate:700ms/);
    const reduced = motion.slice(motion.indexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(/--motion-celebrate:0ms/);
  });

  it("is switched off explicitly under reduced motion too", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ribbon\s*\{\s*animation: none;/,
    );
  });
});

describe("the graduation screen", () => {
  it("has static dots only: no keyframes are applied to them", () => {
    const dot = css.match(/\.dot\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(dot).not.toMatch(/animation|transition/);
  });
});
