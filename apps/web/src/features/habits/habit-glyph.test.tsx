import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HabitGlyph, habitTint } from "./HabitGlyph.tsx";

describe("habitTint (design 23a, 23d)", () => {
  it.each([
    ["book", "orange"],
    ["palette", "pink"],
    ["brain", "purple"],
    ["flower", "purple"],
    ["footprints", "coral"],
    ["dumbbell", "coral"],
    ["coffee", "cream"],
  ] as const)("%s is %s", (key, tint) => {
    expect(habitTint(key)).toBe(tint);
  });

  it("an icon the design does not colour, or none, is neutral", () => {
    expect(habitTint("moon")).toBe("neutral");
    expect(habitTint(null)).toBe("neutral");
    expect(habitTint("unknown-key")).toBe("neutral");
  });
});

describe("HabitGlyph", () => {
  it("draws the habit's glyph on its tint, hidden from assistive tech", () => {
    const { container } = render(<HabitGlyph icon="footprints" />);
    const tile = container.firstElementChild;
    expect(tile?.getAttribute("aria-hidden")).toBe("true");
    expect(tile?.getAttribute("data-tint")).toBe("coral");
    expect(tile?.querySelector("svg")).not.toBeNull();
  });

  it("a private commitment shows the muted eye-off glyph, whatever its icon", () => {
    const { container } = render(<HabitGlyph icon={null} hidden />);
    expect(container.firstElementChild?.getAttribute("data-tint")).toBe("muted");
  });
});
