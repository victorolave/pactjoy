import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Parse the shipped stylesheet, not a copy of its animation settings. jsdom does not run motion. */
function celebrationAnimations() {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(import.meta.dirname, "PactScreen.module.css"), "utf8");
  document.head.append(style);
  if (!style.sheet) throw new Error("celebration stylesheet did not parse");
  const animations: { value: string; media: readonly string[] }[] = [];
  const visit = (rules: CSSRuleList, media: readonly string[] = []) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.MEDIA_RULE) {
        const group = rule as CSSMediaRule;
        visit(group.cssRules, [...media, group.conditionText]);
      } else if (rule.type === CSSRule.STYLE_RULE) {
        const declaration = (rule as CSSStyleRule).style;
        const value = declaration.getPropertyValue("animation");
        if (value) animations.push({ value, media });
        // A longhand-only animation must not silently escape the checks below.
        expect(declaration.getPropertyValue("animation-name")).toBe("");
        expect(declaration.getPropertyValue("animation-duration")).toBe("");
      }
    }
  };
  try {
    visit(style.sheet.cssRules);
  } finally {
    style.remove();
  }
  return animations;
}

describe("WF-R8: pact celebration motion contract", () => {
  it("finishes its one-shot celebration within 700 ms", () => {
    const animations = celebrationAnimations();
    expect(animations.length).toBeGreaterThan(0);
    for (const { value } of animations) {
      const duration = /\b(\d+(?:\.\d+)?)(ms|s)\b/.exec(value);
      if (!duration) throw new Error(`animation duration missing: ${value}`);
      const milliseconds = Number(duration[1]) * (duration[2] === "s" ? 1000 : 1);
      expect(milliseconds).toBeGreaterThan(0);
      expect(milliseconds).toBeLessThanOrEqual(700);
      // No explicit iteration count: CSS defaults to one, and no delay extends the duration.
      const remainder = value.replace(duration[0], "").replace(/cubic-bezier\([^)]*\)/g, "");
      expect(remainder).not.toMatch(/\binfinite\b|\d/);
    }
  });

  it("enables no animation for prefers-reduced-motion: reduce", () => {
    const animations = celebrationAnimations();
    expect(animations.length).toBeGreaterThan(0);
    for (const { media } of animations) {
      // Every animation is opt-in. Neither unconditional rules nor reduce rules may animate.
      expect(media).toContain("(prefers-reduced-motion: no-preference)");
    }
  });
});
