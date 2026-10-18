import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { SeasonDto } from "../../../ports/wire.ts";
import {
  NO_CIRCLE,
  pairCircleFixture,
  soloCircleFixture,
} from "../../../testing/fixtures/circle.ts";
import { myPauseRequestsFixture, pauseApprovalFixture } from "../../../testing/fixtures/pause.ts";
import {
  completedItemFixture,
  feedFixture,
  nudgeFixture,
} from "../../../testing/fixtures/social.ts";
import { renderApp } from "../../../testing/render.tsx";

const ACTIVE = {
  id: "season-1",
  phase: "active",
  lengthWeeks: 8,
  week: 5,
  approvalCount: 2,
  nextSeasonOpen: false,
} as const;

const SEASON: SeasonDto = {
  id: ACTIVE.id,
  circleId: "circle-1",
  timeZone: "UTC",
  nominalStart: "2026-10-04",
  actualStart: null,
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status: "pactOpen",
  approvals: [],
  commitments: [],
  pactClosedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  pactRevision: 1,
};

afterEach(() => vi.useRealTimers());

describe("Circle tab, no circle (31b)", () => {
  // The file's first cold render (imports, route, queries) can pass the 1 s default on a loaded
  // CI runner; the test's own budget stays above the heading's 5 s wait.
  it("offers to create a circle or to join with a code", { timeout: 15_000 }, async () => {
    renderApp({ path: "/circle", myCircle: NO_CIRCLE, nameDraft: "Victor" });
    expect(
      await screen.findByRole("heading", { name: "Tu círculo empieza aquí." }, { timeout: 5000 }),
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

  it("has no activity feed: there is nobody to share it with", async () => {
    const { deps } = renderApp({ path: "/circle", myCircle: NO_CIRCLE, nameDraft: "Victor" });
    await screen.findByRole("heading", { name: "Tu círculo empieza aquí." });
    expect(screen.queryByRole("region", { name: "Actividad del círculo" })).not.toBeInTheDocument();
    expect(deps.api.calls.feed).toBe(0);
  });
});

describe("Circle tab, alone in the circle: the waiting room (7)", () => {
  it("has no activity feed and never reads it", async () => {
    const { deps } = renderApp({ path: "/circle", myCircle: soloCircleFixture() });
    await screen.findByRole("heading", { name: "Esperando a que alguien se una" });
    expect(screen.queryByRole("region", { name: "Actividad del círculo" })).not.toBeInTheDocument();
    expect(deps.api.calls.feed).toBe(0);
  });

  it("resumes habit selection directly while the pact is open", async () => {
    const { location, deps } = renderApp({
      path: "/circle",
      myCircle: { ...soloCircleFixture(), season: { ...ACTIVE, phase: "pactOpen" } },
    });
    deps.api.setPactResponse("getSeason", SEASON);
    deps.api.setPactResponse("listHabits", []);
    await userEvent.click(await screen.findByRole("button", { name: "Preparar la temporada" }));
    expect(
      await screen.findByRole("heading", { name: "¿Qué vas a trabajar esta temporada?" }),
    ).toBeVisible();
    expect(location()).toBe(`/season/${ACTIVE.id}/habits`);
  });

  it.each(["notStarted", "active"] as const)(
    "opens the closed pact instead of preparation in phase %s",
    async (phase) => {
      const { location, deps } = renderApp({
        path: "/circle",
        myCircle: { ...soloCircleFixture(), season: { ...ACTIVE, phase } },
      });
      deps.api.setPactResponse("getSeason", { ...SEASON, status: "active" });
      await userEvent.click(await screen.findByRole("button", { name: "Ver el pacto" }));
      expect(await screen.findByRole("heading", { name: "Pacto cerrado" })).toBeVisible();
      expect(location()).toBe(`/season/${ACTIVE.id}/pact`);
      expect(
        screen.queryByRole("button", { name: "Preparar la temporada" }),
      ).not.toBeInTheDocument();
    },
  );

  it("shows the code and lets the viewer copy it (WC-S8)", async () => {
    const { deps } = renderApp({ path: "/circle" });
    expect(
      await screen.findByRole("heading", { name: "Esperando a que alguien se una" }),
    ).toBeInTheDocument();
    expect(screen.getByText("7K4Q2M")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar código" }));
    expect(deps.sharing.copied).toEqual(["7K4Q2M"]);
  });

  it("enables season preparation and keeps habit action disabled (Q4, WC-S8)", async () => {
    const { location } = renderApp({ path: "/circle" });
    const prepare = await screen.findByRole("button", { name: "Preparar la temporada" });
    const habits = screen.getByRole("button", { name: "Solo crear mis hábitos" });
    expect(prepare).toBeEnabled();
    expect(habits).toBeDisabled();
    expect(screen.getAllByText("Próximamente")).toHaveLength(1);
    expect(habits).toHaveAccessibleDescription("Próximamente");
    await userEvent.click(prepare);
    expect(location()).toBe("/season/new");
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
  it("lets a member prepare the first season from a multi-member circle (WF-R1)", async () => {
    const { location } = renderApp({ path: "/circle", myCircle: pairCircleFixture() });
    await userEvent.click(await screen.findByRole("button", { name: "Preparar la temporada" }));
    expect(await screen.findByRole("heading", { name: "Nueva temporada" })).toBeVisible();
    expect(location()).toBe("/season/new");
  });

  it("resumes habit selection from a multi-member circle while the pact is open", async () => {
    const { location, deps } = renderApp({
      path: "/circle",
      myCircle: pairCircleFixture({ ...ACTIVE, phase: "pactOpen", week: null }),
    });
    deps.api.setPactResponse("getSeason", SEASON);
    deps.api.setPactResponse("listHabits", []);
    await userEvent.click(await screen.findByRole("button", { name: "Preparar la temporada" }));
    expect(
      await screen.findByRole("heading", { name: "¿Qué vas a trabajar esta temporada?" }),
    ).toBeVisible();
    expect(location()).toBe(`/season/${ACTIVE.id}/habits`);
  });

  it("opens the approved pact before the season starts instead of preparing it again", async () => {
    const { location, deps } = renderApp({
      path: "/circle",
      myCircle: pairCircleFixture({ ...ACTIVE, phase: "notStarted", week: null }),
    });
    deps.api.setPactResponse("getSeason", { ...SEASON, status: "active" });
    await userEvent.click(await screen.findByRole("button", { name: "Ver el pacto" }));
    expect(await screen.findByRole("heading", { name: "Pacto cerrado" })).toBeVisible();
    expect(location()).toBe(`/season/${ACTIVE.id}/pact`);
    expect(screen.queryByRole("button", { name: "Preparar la temporada" })).not.toBeInTheDocument();
  });

  it("opens the next season from an ended season once the circle may move on", async () => {
    const { location } = renderApp({
      path: "/circle",
      myCircle: pairCircleFixture({ ...ACTIVE, phase: "ended", nextSeasonOpen: true }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Preparar la temporada" }));
    expect(location()).toBe("/season/new");
    expect(screen.queryByRole("button", { name: "Ver el pacto" })).not.toBeInTheDocument();
  });

  it("keeps the pact link on an ended season the circle cannot leave yet", async () => {
    renderApp({
      path: "/circle",
      myCircle: pairCircleFixture({ ...ACTIVE, phase: "ended", nextSeasonOpen: false }),
    });
    expect(await screen.findByRole("button", { name: "Ver el pacto" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preparar la temporada" })).not.toBeInTheDocument();
  });

  it("keeps the running season view without a preparation or pact action (design 31a)", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture(ACTIVE) });
    expect(await screen.findByText("Pacto activo")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preparar la temporada" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver el pacto" })).not.toBeInTheDocument();
  });

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

  it("lists a member whose account was deleted as a member who left (ADR-0019)", async () => {
    const pair = pairCircleFixture();
    if (pair.circle === null) throw new Error("the pair fixture always has a circle");
    const [andrea, ...rest] = pair.circle.members;
    if (andrea === undefined) throw new Error("the pair fixture lists Andrea first");
    renderApp({
      path: "/circle",
      myCircle: {
        ...pair,
        circle: { ...pair.circle, members: [{ ...andrea, displayName: "" }, ...rest] },
      },
    });
    const members = within(await screen.findByRole("list", { name: "Miembros" }));
    expect(members.getByText("Miembro que salió")).toBeInTheDocument();
    expect(members.getByRole("img", { name: "Miembro que salió" })).toHaveTextContent("?");
    expect(members.getByText("Tú")).toBeInTheDocument();
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

  it("shows the circle activity with its reactions, and still no habit summaries (ADR-0018, was Q7)", async () => {
    renderApp({
      path: "/circle",
      myCircle: pairCircleFixture(ACTIVE),
      feedPages: [feedFixture({ items: [completedItemFixture({ onDate: "2026-10-03" })] })],
    });
    await screen.findByText("Pacto activo");
    expect(screen.getByRole("heading", { name: "Actividad del círculo" })).toBeInTheDocument();
    expect(await screen.findByText("Andrea completó Correr · 5 km.")).toBeInTheDocument();
    for (const name of ["Me encanta", "Celebrar", "Fuego", "Aplaudir"])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    // Out of scope for A3: a member's habits are not summarised in the member rows (31a follow-up).
    const members = within(screen.getByRole("list", { name: "Miembros" }));
    expect(members.queryByText(/Correr/)).not.toBeInTheDocument();
  });

  it("offers the encouragement nudge in the feed", async () => {
    renderApp({
      path: "/circle",
      myCircle: pairCircleFixture(ACTIVE),
      feedPages: [feedFixture({ items: [completedItemFixture()], nudge: nudgeFixture() })],
    });
    expect(
      await screen.findByText("A Andrea le está costando más Correr estas semanas."),
    ).toBeInTheDocument();
    expect(screen.getByText("¿Quieres enviarle ánimo?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
  });

  it("says the circle starts here while no season has started", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture() });
    expect(await screen.findByText("Tu círculo empieza aquí.")).toBeInTheDocument();
    expect(
      screen.getByText("La actividad aparecerá cuando empiece la temporada."),
    ).toBeInTheDocument();
  });

  it("sends a reaction on someone else's item through the API", async () => {
    const { deps } = renderApp({
      path: "/circle",
      myCircle: pairCircleFixture(ACTIVE),
      feedPages: [feedFixture({ items: [completedItemFixture({ onDate: "2026-10-03" })] })],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Celebrar" }));
    await waitFor(() =>
      expect(deps.api.socialCommands).toEqual([
        {
          method: "reactToFeedItem",
          args: ["season-1", "session:commitment-correr:2", "raisedHands"],
        },
      ]),
    );
  });

  it("opens the invite screen from Invitar", async () => {
    const { location } = renderApp({ path: "/circle", myCircle: pairCircleFixture() });
    await userEvent.click(await screen.findByRole("button", { name: "Invitar" }));
    await waitFor(() => expect(location()).toBe("/circle/invite"));
  });
});

describe("renaming the circle (WC-R9)", () => {
  const open = async () => {
    const view = renderApp({ path: "/circle", myCircle: pairCircleFixture() });
    await userEvent.click(await screen.findByRole("button", { name: "Renombrar círculo" }));
    const field = await screen.findByRole("textbox", { name: "Nombre del círculo" });
    return { ...view, field };
  };

  it("starts from the current name, saves the new one and updates the tab without a reload", async () => {
    const { deps, field } = await open();
    expect(field).toHaveValue("Andrea & Victor");
    await userEvent.clear(field);
    await userEvent.type(field, " Los Pactos ");
    const renamed = pairCircleFixture();
    if (renamed.circle !== null)
      deps.api.setMyCircle({ ...renamed, circle: { ...renamed.circle, name: "Los Pactos" } });
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("heading", { name: "Los Pactos" })).toBeInTheDocument();
    expect(deps.api.circleCommands.find((c) => c.method === "renameCircle")?.args).toEqual([
      "circle-1",
      "Los Pactos",
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the sheet and the typed text when the poll finds a second member (W1)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const { deps } = renderApp({ path: "/circle" });
    await user.click(await screen.findByRole("button", { name: "Renombrar círculo" }));
    const field = await screen.findByRole("textbox", { name: "Nombre del círculo" });
    await user.clear(field);
    await user.type(field, "Los Pactos");
    deps.api.setMyCircle(pairCircleFixture());
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(await screen.findByText("Andrea")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nombre del círculo" })).toHaveValue("Los Pactos");
  });

  it("refuses an empty name without calling the server", async () => {
    const { deps, field } = await open();
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Ponle un nombre al círculo.")).toBeInTheDocument();
    expect(deps.api.calls.renameCircle).toBe(0);
  });

  it("shows the server's refusal under the field and keeps what was typed", async () => {
    const { deps, field } = await open();
    deps.api.failNext("renameCircle", new ApiError("InvalidName", 422, null));
    await userEvent.type(field, "x");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/hasta 40 caracteres/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nombre del círculo" })).toHaveValue(
      "Andrea & Victorx",
    );
  });

  it("says there is no connection and stays open when offline (WC-R11)", async () => {
    const { deps } = await open();
    deps.api.failNext("renameCircle", new ApiError("NetworkError", 0, null));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/Sin conexión/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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

describe("Circle tab, pause requests (screen 28)", () => {
  const withRequest = () =>
    myPauseRequestsFixture({
      awaitingMe: [
        pauseApprovalFixture({
          requester: { memberId: "member-andrea", displayName: "Andrea" },
          commitments: [{ kind: "hidden", commitmentId: "commitment-9" }],
        }),
      ],
    });

  it("lists a request awaiting the viewer, with a private Commitment unnamed, and keeps the feed out of the approval list", async () => {
    const view = renderApp({ path: "/circle", myCircle: pairCircleFixture(ACTIVE) });
    view.deps.api.setMyPauseRequests(withRequest());
    expect(await screen.findByText("Andrea pidió pausar un objetivo privado")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pausas por aprobar" })).toBeInTheDocument();
    const approvals = screen.getByRole("region", { name: "Pausas por aprobar" });
    expect(within(approvals).queryByText(/Actividad del círculo/)).not.toBeInTheDocument();
    // The feed is its own section of the tab (ADR-0018), after the pause actions.
    expect(screen.getByRole("region", { name: "Actividad del círculo" })).toBeInTheDocument();
  });

  it("answers from the card", async () => {
    const view = renderApp({ path: "/circle", myCircle: pairCircleFixture(ACTIVE) });
    view.deps.api.setMyPauseRequests(withRequest());
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    await waitFor(() =>
      expect(view.deps.api.pauseCommands).toEqual([
        { method: "respondToPause", args: ["pause-9", "approve"] },
      ]),
    );
    expect(await screen.findByText("Aprobaste")).toBeInTheDocument();
  });

  it("shows nothing about pauses to someone alone in the circle (nobody to ask)", async () => {
    const view = renderApp({ path: "/circle", myCircle: soloCircleFixture() });
    view.deps.api.setMyPauseRequests(withRequest());
    await screen.findByRole("heading", { name: "Andrea & Victor" });
    expect(screen.queryByText("Pausas por aprobar")).not.toBeInTheDocument();
  });

  it("offers to pause a Commitment while the season runs, and opens the request sheet", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture(ACTIVE) });
    await userEvent.click(await screen.findByRole("button", { name: "Pausar un compromiso" }));
    expect(await screen.findByRole("dialog", { name: "Pausar un compromiso" })).toBeInTheDocument();
  });

  it("does not offer it before the season runs", async () => {
    renderApp({ path: "/circle", myCircle: pairCircleFixture({ ...ACTIVE, phase: "pactOpen" }) });
    await screen.findByText("Andrea");
    expect(screen.queryByRole("button", { name: "Pausar un compromiso" })).not.toBeInTheDocument();
  });
});
