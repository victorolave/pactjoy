import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import {
  completedItemFixture,
  consistentWeekItemFixture,
  emptyFeedFixture,
  feedFixture,
  seasonStartedItemFixture,
} from "../../../testing/fixtures/social.ts";
import { renderApp } from "../../../testing/render.tsx";

const FOUR = [
  completedItemFixture({ onDate: "2026-10-03" }),
  consistentWeekItemFixture({ onDate: "2026-10-02" }),
  completedItemFixture({
    key: "session:c2:1",
    onDate: "2026-10-01",
    subject: { kind: "private" },
    value: null,
  }),
  seasonStartedItemFixture(),
];

describe("Today: the circle's recent activity (ADR-0018)", () => {
  it("previews the first three items below the day's rows and links to the circle", async () => {
    renderApp({ feedPages: [feedFixture({ items: FOUR })] });
    const section = await screen.findByRole("region", { name: "Actividad del círculo" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
    expect(within(section).getByText("Andrea completó Correr · 5 km.")).toBeInTheDocument();
    expect(within(section).getByText("Andrea completó un objetivo privado.")).toBeInTheDocument();
    expect(within(section).queryByText(/Empezó la temporada/)).not.toBeInTheDocument();
    expect(
      within(section).getByRole("link", { name: "Ver actividad del círculo" }),
    ).toHaveAttribute("href", "/circle");
  });

  it("sits after the viewer's own opportunities", async () => {
    renderApp({ feedPages: [feedFixture({ items: FOUR })] });
    const section = await screen.findByRole("region", { name: "Actividad del círculo" });
    const rows = await screen.findByRole("heading", { name: "Para hoy" });
    expect(rows.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no reaction chips: reacting happens in the circle", async () => {
    renderApp({ feedPages: [feedFixture({ items: FOUR })] });
    const section = await screen.findByRole("region", { name: "Actividad del círculo" });
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens the Circle tab from the link", async () => {
    const { location } = renderApp({ feedPages: [feedFixture({ items: FOUR })] });
    await userEvent.click(await screen.findByRole("link", { name: "Ver actividad del círculo" }));
    await waitFor(() => expect(location()).toBe("/circle"));
  });

  it("is not there when the circle has no activity", async () => {
    const { deps } = renderApp({ feedPages: [emptyFeedFixture()] });
    await screen.findByRole("heading", { name: "Para hoy" });
    await waitFor(() => expect(deps.api.calls.feed).toBeGreaterThan(0));
    expect(screen.queryByRole("region", { name: "Actividad del círculo" })).not.toBeInTheDocument();
  });

  it("is not there when the feed cannot be read: Today never waits for it", async () => {
    const { deps } = renderApp({});
    deps.api.failNext("feed", new ApiError("NetworkError", 0, null));
    await screen.findByRole("heading", { name: "Para hoy" });
    expect(screen.queryByRole("region", { name: "Actividad del círculo" })).not.toBeInTheDocument();
    expect(screen.queryByText("No pudimos cargar la actividad.")).not.toBeInTheDocument();
  });
});
