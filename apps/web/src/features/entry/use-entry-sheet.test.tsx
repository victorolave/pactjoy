import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { type EntrySheetRoute, useEntrySheet } from "./use-entry-sheet.ts";

let route: EntrySheetRoute;

function Probe() {
  route = useEntrySheet();
  return <output aria-label="where">{useLocation().pathname}</output>;
}

describe("useEntrySheet close (review WA-S4)", () => {
  it("goes back ONE step even when asked twice in the same tick", () => {
    // History: /a, /b, then the sheet open on top (not the landing page, so closing goes back).
    render(
      <MemoryRouter initialEntries={["/a", "/b", "/b?entry=c1"]} initialIndex={2}>
        <Probe />
      </MemoryRouter>,
    );
    act(() => {
      route.close();
      route.close();
    });
    expect(screen.getByLabelText("where")).toHaveTextContent("/b");
  });

  it("closes again after the location has moved on", () => {
    render(
      <MemoryRouter initialEntries={["/a", "/b", "/b?entry=c1"]} initialIndex={2}>
        <Probe />
      </MemoryRouter>,
    );
    act(() => route.close());
    act(() => route.close());
    expect(screen.getByLabelText("where")).toHaveTextContent("/a");
  });
});
