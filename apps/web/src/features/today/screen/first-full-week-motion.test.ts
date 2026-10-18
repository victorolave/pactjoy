import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Motion guard for the first full week celebration (spec R2/S10): the Together ribbon draws once,
 * within the celebrate token, and nothing moves under reduced motion. The card and the seen flag
 * do not depend on the animation.
 */
const css = readFileSync(join(import.meta.dirname, "FirstFullWeekCelebration.module.css"), "utf8");

describe("the first full week ribbon", () => {
  it("draws once with the celebrate token and only that animation exists", () => {
    expect(css).toMatch(/\.ribbon\s*\{[^}]*animation:\s*draw var\(--motion-celebrate\)[^}]*both;/);
    expect(css).not.toMatch(/animation-iteration-count|infinite/);
    expect([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])).toEqual(["draw"]);
  });

  it("is switched off explicitly under reduced motion", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ribbon\s*\{\s*animation: none;/,
    );
  });
});
