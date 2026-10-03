import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Centered } from "./Centered.tsx";

describe("Centered", () => {
  it("wraps its child and marks itself", () => {
    render(
      <Centered>
        <button type="button">Ayer no salió</button>
      </Centered>,
    );
    expect(screen.getByRole("button").parentElement).toHaveAttribute("data-centered", "true");
  });

  it("centres across the width of what contains it", () => {
    const css = readFileSync(join(import.meta.dirname, "Centered.module.css"), "utf8");
    expect(css).toMatch(/justify-content:\s*center/);
    expect(css).toMatch(/align-self:\s*stretch/);
  });
});
