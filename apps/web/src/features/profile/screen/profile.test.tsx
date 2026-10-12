import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { HabitDto } from "../../../ports/wire.ts";
import { NO_CIRCLE, pairCircleFixture } from "../../../testing/fixtures/circle.ts";
import { noCircleTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const openRename = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "Cambiar mi nombre" }));
  return screen.findByRole("textbox", { name: "Tu nombre en el círculo" });
};

describe("Perfil (design 39)", () => {
  it("shows the avatar initial, the displayName in the circle and the email (PS-S1)", async () => {
    renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    expect(await screen.findByRole("heading", { name: "Victor" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Victor" })).toHaveTextContent("V");
    expect(screen.getByText("andrea@example.com")).toBeInTheDocument();
  });

  it("shows the design's sections in an empty state, with nothing invented (PS-S1)", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    deps.api.setSeasonHistory({ seasons: [] });
    for (const title of [
      "Tus hábitos",
      "Temporadas",
      "Consistencia histórica",
      "Hábitos graduados",
    ]) {
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/Aún no hay temporadas/)).toBeInTheDocument();
    expect(screen.getByText(/La verás cuando cierres tu primera temporada/)).toBeInTheDocument();
    expect(screen.queryByText(/En desarrollo/)).not.toBeInTheDocument();
  });

  it("without a circle shows the name draft (PS-R1; the email fallback is the pure profileName)", async () => {
    renderApp({
      path: "/profile",
      myCircle: NO_CIRCLE,
      today: noCircleTodayFixture(),
      nameDraft: "Vic",
    });
    expect(await screen.findByRole("heading", { name: "Vic" })).toBeInTheDocument();
    expect(screen.getByText("andrea@example.com")).toBeInTheDocument();
  });

  it("offers to change the name only when there is a circle (PS-R3)", async () => {
    renderApp({
      path: "/profile",
      myCircle: NO_CIRCLE,
      today: noCircleTodayFixture(),
      nameDraft: "Vic",
    });
    await screen.findByRole("heading", { name: "Vic" });
    expect(screen.queryByRole("button", { name: "Cambiar mi nombre" })).not.toBeInTheDocument();
  });

  it("has its h1 even while the name is still loading", async () => {
    renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Victor" });
  });

  it("has no sign out button of its own any more: it lives in Ajustes", async () => {
    renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    await screen.findByRole("heading", { name: "Victor" });
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
  });

  it("opens Ajustes from the gear and comes back with Volver", async () => {
    const { location } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    await userEvent.click(await screen.findByRole("button", { name: "Ajustes" }));
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
    expect(location()).toBe("/profile/settings");
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Volver al perfil" }));
    expect(await screen.findByRole("heading", { name: "Victor" })).toBeInTheDocument();
  });
});

describe("Perfil, seasons and graduated habits (season-close-graduation S8)", () => {
  const habit = (id: string, name: string, graduatedAt: string | null): HabitDto => ({
    id,
    name,
    why: null,
    category: null,
    icon: null,
    graduatedAt,
    createdAt: "2026-08-20T12:00:00.000Z",
    version: 1,
  });

  it("keeps the empty states when there is no closed season and no graduated habit", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    deps.api.setSeasonHistory({ seasons: [] });
    deps.api.setPactResponse("listHabits", [habit("h-1", "Leer", null)]);
    await screen.findByRole("heading", { name: "Victor" });
    expect(await screen.findByText(/Aún no hay temporadas/)).toBeInTheDocument();
    expect(
      await screen.findByText("Aún ninguno. Graduar es decisión tuya, al cerrar una temporada."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Temporada de/ })).not.toBeInTheDocument();
  });

  it("lists the closed seasons as links to their read-only results", async () => {
    const { location } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    const link = await screen.findByRole("link", { name: /Temporada de 8 semanas/ });
    expect(link).toHaveTextContent("25 ago – 19 oct");
    expect(link).toHaveTextContent("Puesto 2 de 2");
    expect(link).toHaveTextContent("792 pts");
    expect(screen.queryByText(/Aún no hay temporadas/)).not.toBeInTheDocument();
    await userEvent.click(link);
    expect(location()).toBe("/season/season-0/results");
  });

  it("says so when the member closed a season without their own decisions", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    deps.api.setSeasonHistory({
      seasons: [
        {
          seasonId: "season-9",
          lengthWeeks: 4,
          actualStart: "2026-06-01",
          lastDay: "2026-06-28",
          points: 0,
          rank: null,
          memberCount: 1,
          closedByMe: false,
        },
      ],
    });
    const link = await screen.findByRole("link", { name: /Temporada de 4 semanas/ });
    expect(link).toHaveTextContent("Cerrada sin tus decisiones");
    expect(link).not.toHaveTextContent("Puesto");
  });

  it("lists the graduated habits, newest first, and leaves the others out", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    deps.api.setPactResponse("listHabits", [
      habit("h-1", "Leer", "2026-09-01T10:00:00.000Z"),
      habit("h-2", "Dibujar", null),
      habit("h-3", "Meditar", "2026-10-20T10:00:00.000Z"),
    ]);
    const section = (await screen.findByRole("heading", { name: "Hábitos graduados" }))
      .parentElement;
    if (section === null) throw new Error("section expected");
    const rows = await within(section).findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Meditar"),
      expect.stringContaining("Leer"),
    ]);
    expect(rows[0]).toHaveTextContent("Graduado el 20 de octubre");
    expect(rows[0]).toHaveTextContent("🎓 Graduado");
    expect(screen.queryByText("Dibujar")).not.toBeInTheDocument();
  });

  it("still shows the page when the season history cannot be read", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    deps.api.failNext("getSeasonHistory", new ApiError("NetworkError", 0, null));
    expect(await screen.findByRole("heading", { name: "Victor" })).toBeInTheDocument();
    expect(await screen.findByText("No pudimos cargar tus temporadas.")).toBeInTheDocument();
  });

  it("keeps Consistencia histórica and Tus hábitos as their empty states", async () => {
    renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    expect(await screen.findByText(/La verás cuando cierres tu primera temporada/)).toBeVisible();
    expect(screen.getByText(/Aún no hay hábitos/)).toBeVisible();
  });
});

describe("renaming my own name (Q9, PS-R3)", () => {
  it("starts from the current name, saves the trimmed new one and updates Perfil (PS-S3)", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    const field = await openRename();
    expect(field).toHaveValue("Victor");
    await userEvent.clear(field);
    await userEvent.type(field, "  Vic  ");
    deps.api.setMyCircle(renamedTo("Vic"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("heading", { name: "Vic" })).toBeInTheDocument();
    expect(deps.api.circleCommands.find((c) => c.method === "renameMyDisplayName")?.args).toEqual([
      "circle-1",
      "Vic",
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a name already used under the field and keeps what was typed (PS-S2)", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    const field = await openRename();
    deps.api.failNext("renameMyDisplayName", new ApiError("DisplayNameTaken", 409, null));
    await userEvent.clear(field);
    await userEvent.type(field, "andrea");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Ese nombre ya lo usa alguien del círculo. Elige otro."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tu nombre en el círculo" })).toHaveValue("andrea");
  });

  it("refuses an empty or 31-character name without calling the server", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    const field = await openRename();
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Escribe tu nombre.")).toBeInTheDocument();
    await userEvent.type(field, "x".repeat(31));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(
      await screen.findByText("Tu nombre puede tener hasta 30 caracteres."),
    ).toBeInTheDocument();
    expect(deps.api.calls.renameMyDisplayName).toBe(0);
  });

  it("shows other failures in the sheet", async () => {
    const { deps } = renderApp({ path: "/profile", myCircle: pairCircleFixture() });
    const field = await openRename();
    deps.api.failNext("renameMyDisplayName", new ApiError("NetworkError", 0, null));
    await userEvent.type(field, "o");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
  });
});

function renamedTo(displayName: string) {
  const circle = pairCircleFixture();
  if (circle.circle === null) throw new Error("fixture has a circle");
  return {
    ...circle,
    circle: {
      ...circle.circle,
      members: circle.circle.members.map((m) => (m.isYou ? { ...m, displayName } : m)),
    },
  };
}
