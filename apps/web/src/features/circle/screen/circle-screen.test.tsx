import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { NO_CIRCLE, pairCircleFixture } from "../../../testing/fixtures/circle.ts";
import { renderApp } from "../../../testing/render.tsx";

const ACTIVE = {
  id: "season-1",
  phase: "active",
  lengthWeeks: 8,
  week: 5,
  approvalCount: 2,
} as const;

afterEach(() => vi.useRealTimers());

describe("Circle tab, no circle (31b)", () => {
  it("offers to create a circle or to join with a code", async () => {
    renderApp({ path: "/circle", myCircle: NO_CIRCLE, nameDraft: "Victor" });
    expect(
      await screen.findByRole("heading", { name: "Tu círculo empieza aquí." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear círculo" })).toHaveAttribute(
      "href",
      "/circle/new",
    );
    expect(screen.getByRole("link", { name: "Tengo un código" })).toHaveAttribute(
      "href",
      "/circle/join",
    );
  });
});

describe("Circle tab, alone in the circle: the waiting room (7)", () => {
  it("shows the code and lets the viewer copy it (WC-S8)", async () => {
    const { deps } = renderApp({ path: "/circle" });
    expect(
      await screen.findByRole("heading", { name: "Esperando a que alguien se una" }),
    ).toBeInTheDocument();
    expect(screen.getByText("7K4Q2M")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar código" }));
    expect(deps.sharing.copied).toEqual(["7K4Q2M"]);
  });

  it("keeps the season and habit actions visible, disabled and labelled, and they do nothing (Q4, WC-S8)", async () => {
    const { location } = renderApp({ path: "/circle" });
    const prepare = await screen.findByRole("button", { name: "Preparar la temporada" });
    const habits = screen.getByRole("button", { name: "Solo crear mis hábitos" });
    expect(prepare).toBeDisabled();
    expect(habits).toBeDisabled();
    expect(screen.getAllByText("Próximamente")).toHaveLength(2);
    expect(prepare).toHaveAccessibleDescription("Próximamente");
    expect(habits).toHaveAccessibleDescription("Próximamente");
    await userEvent.click(prepare);
    expect(location()).toBe("/circle");
  });

  it("promises no push and never calls a solo circle incomplete (WC-R8, OB-R7)", async () => {
    renderApp({ path: "/circle" });
    await screen.findByRole("heading", { name: "Esperando a que alguien se una" });
    expect(screen.queryByText(/Te avisaremos/)).not.toBeInTheDocument();
    expect(screen.queryByText(/De 2 a 6/)).not.toBeInTheDocument();
  });

  it("hides Compartir where the share sheet does not exist, and keeps Copiar", async () => {
    renderApp({ path: "/circle", canShare: false });
    expect(await screen.findByRole("button", { name: "Copiar código" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compartir código" })).not.toBeInTheDocument();
  });

  it("asks for a new code when the one shown has expired (WC-R2)", async () => {
    const { deps } = renderApp({ path: "/circle", now: Date.parse("2026-10-09T12:00:00.000Z") });
    expect(await screen.findByText("Este código ya caducó.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nuevo código" }));
    await waitFor(() => expect(deps.api.calls.generateInvite).toBe(1));
  });

  it("looks for a second member every 30 seconds and shows the circle when one joins (D11)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { deps } = renderApp({ path: "/circle" });
    await screen.findByRole("heading", { name: "Esperando a que alguien se una" });
    expect(deps.api.calls.getMyCircle).toBe(1);
    deps.api.setMyCircle(pairCircleFixture());
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(await screen.findByText("Andrea")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Esperando a que alguien se una" }),
    ).not.toBeInTheDocument();
  });

  it("stops looking once there are two members", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { deps } = renderApp({ path: "/circle", myCircle: pairCircleFixture() });
    await screen.findByText("Andrea");
    await act(() => vi.advanceTimersByTimeAsync(90_000));
    expect(deps.api.calls.getMyCircle).toBe(1);
  });
});

describe("Circle tab with people (31a-lite)", () => {
  it("lists the members with their initials and marks the viewer (WC-R7)", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture() });
    expect(await screen.findByRole("heading", { name: "Andrea & Victor" })).toBeInTheDocument();
    const members = within(screen.getByRole("list"));
    expect(members.getByText("Andrea")).toBeInTheDocument();
    expect(members.getByText("Tú")).toBeInTheDocument();
    expect(members.queryByText(/Victor/)).not.toBeInTheDocument();
    expect(members.getByRole("img", { name: "Victor" })).toHaveTextContent("V");
    expect(members.getByRole("img", { name: "Andrea" })).toHaveTextContent("A");
  });

  it("shows the pact and the week of a running season", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture(ACTIVE) });
    expect(await screen.findByText("Pacto activo")).toBeInTheDocument();
    expect(screen.getAllByText("Semana 5 de 8").length).toBeGreaterThan(0);
  });

  it("counts the approvals while the pact is open", async () => {
    renderApp({
      path: "/circle",
      myCircle: pairCircleFixture({ ...ACTIVE, phase: "pactOpen", week: null, approvalCount: 1 }),
    });
    expect(await screen.findByText("Pacto abierto")).toBeInTheDocument();
    expect(screen.getByText("1 de 2 lo han aprobado")).toBeInTheDocument();
  });

  it("says there is no season yet when there is none", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture() });
    expect(await screen.findByText(/Todavía no hay temporada/)).toBeInTheDocument();
  });

  it("has no habit summaries, feed, reactions or nudges (Q7)", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture(ACTIVE) });
    await screen.findByText("Pacto activo");
    expect(screen.queryByText("Actividad del círculo")).not.toBeInTheDocument();
    expect(screen.queryByText(/ánimo/i)).not.toBeInTheDocument();
    for (const emoji of ["❤️", "🙌", "🔥", "👏"])
      expect(screen.queryByText(emoji)).not.toBeInTheDocument();
  });

  it("opens the invite screen from Invitar", async () => {
    const { location } = renderApp({ path: "/circle", myCircle: pairCircleFixture() });
    await userEvent.click(await screen.findByRole("button", { name: "Invitar" }));
    await waitFor(() => expect(location()).toBe("/circle/invite"));
  });
});

describe("Circle tab, loading and failing", () => {
  it("shows the last circle read with an offline notice when the connection drops", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture(), online: false });
    expect(await screen.findByRole("heading", { name: "Andrea & Victor" })).toBeInTheDocument();
    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument();
  });

  it("offers to retry when the circle cannot be loaded, and recovers", async () => {
    const { deps } = renderApp({
      path: "/circle",
      myCircle: pairCircleFixture(),
      myCircleFailures: [new ApiError("ServiceUnavailable", 503, null)],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Andrea & Victor" })).toBeInTheDocument();
    expect(deps.api.calls.getMyCircle).toBe(2);
  });
});
