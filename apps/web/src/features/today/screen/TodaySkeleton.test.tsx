import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TodaySkeleton } from "./TodaySkeleton.tsx";

const css = readFileSync(join(import.meta.dirname, "TodaySkeleton.module.css"), "utf8");

describe("TodaySkeleton (design 15e)", () => {
  it("mirrors the design: a section title, two row cards with a tile and two lines, and the season card", () => {
    const { container } = render(<TodaySkeleton />);
    const status = screen.getByRole("status", { name: "Cargando Hoy" });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll('[data-skeleton="title"]')).toHaveLength(1);
    const rows = container.querySelectorAll('[data-skeleton="row"]');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelectorAll('[data-skeleton="tile"]')).toHaveLength(1);
      expect(row.querySelectorAll('[data-skeleton="line"]')).toHaveLength(2);
    }
    expect(container.querySelectorAll('[data-skeleton="card"]')).toHaveLength(1);
  });

  it("builds its rows from the real row card, so they cannot drift from it", () => {
    const { container } = render(<TodaySkeleton />);
    for (const row of container.querySelectorAll('[data-skeleton="row"]')) {
      expect(row).toHaveClass("pj-card");
      expect(row.firstElementChild?.className).toMatch(/card/);
    }
  });

  it("is invisible to assistive tech apart from the loading announcement", () => {
    const { container } = render(<TodaySkeleton />);
    expect(
      container.querySelector('[data-skeleton="title"]')?.closest("[aria-hidden]"),
    ).not.toBeNull();
  });

  it("pulses opacity .55 to 1 over 900 ms, ease-in-out, alternating, as the prototype does", () => {
    expect(css).toMatch(/opacity:\s*0\.55/);
    expect(css).toMatch(/animation:\s*pulse var\(--motion-pulse\) ease-in-out infinite alternate/);
  });

  it("stops pulsing under reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation:\s*none/s);
  });

  it("uses the sunken surface and token sizes, never raw colours", () => {
    expect(css).toContain("var(--surface-sunken)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
