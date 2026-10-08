import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link } from "react-router";
import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import type { MyCircle } from "../ports/pactjoy-api.ts";
import type { SeasonDto } from "../ports/wire.ts";
import { NO_CIRCLE, pairCircleFixture } from "../testing/fixtures/circle.ts";
import {
  activeSeasonProgress,
  commitmentProgress,
  endedSeasonProgress,
  firstDaySeasonProgress,
  peerMemberProgress,
  weekSummary,
} from "../testing/fixtures/season-progress.ts";
import { renderApp, renderInProviders } from "../testing/render.tsx";
import { AppRoutes } from "./routes.tsx";

const renderAt = (path: string, signedIn = true) => renderApp({ path, signedIn });

describe("AppRoutes", () => {
  it("shows Perfil when its tab is pressed (WF-S3)", async () => {
    renderAt("/");
    await userEvent.click(screen.getByRole("link", { name: "Perfil" }));
    expect(await screen.findByRole("heading", { name: "Victor" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
  });

  it("renders /circle with the tab bar", () => {
    renderAt("/circle");
    expect(screen.getByRole("heading", { name: "Círculo" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("renders /profile with the tab bar, titled Perfil and showing the member's name", async () => {
    renderAt("/profile");
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Victor" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("renders Today at / inside a main landmark with the tab bar", () => {
    renderAt("/");
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("renders /login without the tab bar", () => {
    renderAt("/login", false);
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("sends an unknown path to Today", () => {
    renderAt("/nope");
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
  });

  it("sends a visitor without a session from Today to /login", () => {
    renderAt("/", false);
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
  });

  it("sends a signed-in user from /login to Today", () => {
    renderAt("/login");
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
  });
});

const CURRENT = {
  id: "season-1",
  phase: "active",
  lengthWeeks: 8,
  week: 5,
  approvalCount: 2,
} as const;
const MEMBER = "/season/season-1/members/member-andrea";
const DETAIL = "/season/season-1/commitments/commitment-leer";
const SUMMARY = "/season/season-1/weeks/3/summary";

function progressApp(
  path = "/season",
  view = activeSeasonProgress(),
  myCircle: MyCircle = pairCircleFixture(CURRENT),
) {
  const app = renderApp({ path, myCircle, nameDraft: "Victor" });
  app.deps.api.progress.setSeasonProgress("season-1", view);
  app.deps.api.progress.setMemberProgress("season-1", "member-andrea", peerMemberProgress());
  app.deps.api.progress.setCommitmentProgress("season-1", "commitment-leer", commitmentProgress());
  app.deps.api.progress.setWeekSummary("season-1", 3, weekSummary());
  return app;
}

describe("Lote 2 route integration (A4)", () => {
  it.each([1, 2, 3, 6])(
    "navigates own commitment and back in a %i-member circle",
    async (memberCount) => {
      const app = progressApp("/season", activeSeasonProgress({ memberCount }));
      expect(await screen.findByRole("heading", { name: "Tu temporada" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Temporada" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await userEvent.click(screen.getByRole("button", { name: "Leer, 105 de 250 puntos" }));
      expect(await screen.findByRole("heading", { name: "Leer" })).toBeInTheDocument();
      expect(app.location()).toBe(DETAIL);
      expect(screen.getByRole("heading", { name: "Historial" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Temporada" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await userEvent.click(screen.getByRole("button", { name: "Volver a Temporada" }));
      expect(await screen.findByRole("heading", { name: "Tu temporada" })).toBeInTheDocument();
      expect(app.location()).toBe("/season");
    },
  );

  it.each([2, 3, 6])(
    "opens a peer by MemberId, preserves privacy and supports browser Back (%i)",
    async (memberCount) => {
      const app = progressApp("/season", activeSeasonProgress({ memberCount }));
      const name = memberCount === 2 ? "Ver la temporada de Andrea" : "1. Andrea, 412 pts";
      await userEvent.click(await screen.findByRole("button", { name }));
      expect(await screen.findByRole("heading", { name: "Andrea" })).toBeInTheDocument();
      expect(app.location()).toBe(MEMBER);
      expect(screen.getByText("Objetivo privado")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Correr|Objetivo privado/ }),
      ).not.toBeInTheDocument();
      app.back();
      expect(await screen.findByRole("heading", { name: "Tu temporada" })).toBeInTheDocument();
    },
  );

  it("reopens only the last closed week AFTER commitments, then returns to Today", async () => {
    const app = progressApp();
    const cardTitle = await screen.findByText("Semana 4 cerrada");
    expect(screen.queryByText("Semana 3 cerrada")).not.toBeInTheDocument();
    const row = screen.getByRole("button", { name: "Leer, 105 de 250 puntos" });
    expect(row.compareDocumentPosition(cardTitle) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Ver" }));
    expect(
      await screen.findByRole("heading", { name: "Tu mejor semana hasta ahora." }),
    ).toBeInTheDocument();
    expect(app.location()).toBe(SUMMARY);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Seguir con mi día" }));
    await waitFor(() => expect(app.location()).toBe("/"));
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
  });

  it("has no closed-week card on the first day (23b)", async () => {
    progressApp("/season", firstDaySeasonProgress());
    expect(
      await screen.findByRole("heading", { name: "La temporada empieza hoy." }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Semana \d+ cerrada/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver" })).not.toBeInTheDocument();
  });

  it("reopens the final counted week after season end, not the penultimate week", async () => {
    const view = endedSeasonProgress();
    const last = view.weeks[7];
    if (!last) throw new Error("fixture has eight weeks");
    const app = progressApp(
      "/season",
      {
        ...view,
        weeks: view.weeks.map((w) =>
          w.weekIndex === 7 ? { ...w, facts: { counted: true, editable: true, final: false } } : w,
        ),
      },
      pairCircleFixture({ ...CURRENT, phase: "ended" }),
    );
    app.deps.api.progress.setWeekSummary(
      "season-1",
      7,
      weekSummary({ ...last, weekIndex: 7, headline: null }),
    );
    expect(await screen.findByText("Semana 8 cerrada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver" }));
    await waitFor(() => expect(app.location()).toBe("/season/season-1/weeks/7/summary"));
    expect(await screen.findByRole("heading", { name: /Semana 8 de 8/ })).toBeInTheDocument();
  });

  it.each([MEMBER, DETAIL])(
    "supports originless deep link %s with a deterministic back fallback",
    async (path) => {
      const app = progressApp(path);
      expect(
        await screen.findByRole("heading", { name: path === MEMBER ? "Andrea" : "Leer" }),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Volver a Temporada" }));
      expect(await screen.findByRole("heading", { name: "Tu temporada" })).toBeInTheDocument();
      expect(app.location()).toBe("/season");
    },
  );

  it("supports the difficult summary direct link (25c); Cerrar returns Today", async () => {
    const app = progressApp(SUMMARY);
    app.deps.api.progress.setWeekSummary(
      "season-1",
      3,
      weekSummary({ headline: "difficult", consistency: 40 }),
    );
    expect(
      await screen.findByRole("heading", { name: "Esta semana ha costado más." }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it.each(["/season", MEMBER, DETAIL, SUMMARY])("requires a session for %s", async (path) => {
    const app = renderApp({ path, signedIn: false });
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(app.location()).toBe("/login");
  });

  it.each(["pactOpen", "notStarted"] as const)(
    "sends %s progress links through the existing pact flow, not an error",
    async (phase) => {
      const app = progressApp(
        DETAIL,
        activeSeasonProgress(),
        pairCircleFixture({ ...CURRENT, phase, week: null }),
      );
      const season: SeasonDto = {
        id: "season-1",
        circleId: "circle-1",
        timeZone: "UTC",
        nominalStart: "2026-10-04",
        actualStart: phase === "pactOpen" ? null : "2026-10-04",
        lengthWeeks: 8,
        reviewCadenceWeeks: 2,
        status: phase === "pactOpen" ? "pactOpen" : "active",
        approvals: [],
        commitments: [],
        pactClosedAt: null,
        createdAt: "2026-10-01T00:00:00.000Z",
        version: 1,
        pactRevision: 1,
      };
      app.deps.api.setPactResponse("getSeason", season);
      expect(
        await screen.findByRole("heading", {
          name: phase === "pactOpen" ? "Revisión del pacto" : "Pacto cerrado",
        }),
      ).toBeInTheDocument();
      expect(app.location()).toBe("/season/season-1/pact");
      expect(screen.queryByText("No pudimos cargar la temporada.")).not.toBeInTheDocument();
    },
  );

  it("preserves no-season creation and no-circle Today destinations", async () => {
    const app = renderApp({ path: "/season" });
    expect(await screen.findByRole("heading", { name: "Nueva temporada" })).toBeInTheDocument();
    expect(app.location()).toBe("/season/new");
    app.unmount();
    const absent = renderApp({ path: "/season", myCircle: NO_CIRCLE, nameDraft: "Victor" });
    await waitFor(() => expect(absent.location()).toBe("/"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    [MEMBER, "getMemberProgress", 403],
    [DETAIL, "getCommitmentProgress", 404],
    [SUMMARY, "getWeekSummary", 400],
  ] as const)(
    "redirects unavailable %s to Temporada instead of a connection error",
    async (path, method, status) => {
      const app = progressApp(path);
      app.deps.api.progress.failNext(method, new ApiError("NotFound", status, null));
      expect(await screen.findByRole("heading", { name: "Tu temporada" })).toBeInTheDocument();
      expect(app.location()).toBe("/season");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("keeps a genuine season query failure recoverable (23c)", async () => {
    const app = progressApp();
    app.deps.api.progress.failNext("getSeasonProgress", new ApiError("NetworkError", 0, null));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar la temporada.");
    await userEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Tu temporada" })).toBeInTheDocument();
  });

  it("retries the closed-week card independently without hiding the commitments", async () => {
    const app = progressApp();
    app.deps.api.progress.failNext("getWeekSummary", new ApiError("NetworkError", 0, null));
    const alert = await screen.findByRole("alert");
    expect(screen.getByRole("heading", { name: "Tus compromisos" })).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Semana 4 cerrada")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver" }));
    expect(
      await screen.findByRole("heading", { name: "Tu mejor semana hasta ahora." }),
    ).toBeInTheDocument();
    expect(app.location()).toBe(SUMMARY);
  });

  it("honors a Today origin without changing Today's entry controls", async () => {
    const app = renderInProviders(
      <>
        <AppRoutes />
        <Link to={DETAIL} state={{ from: "today" }}>
          Open detail
        </Link>
      </>,
      {
        myCircle: pairCircleFixture(CURRENT),
      },
    );
    app.deps.api.progress.setCommitmentProgress(
      "season-1",
      "commitment-leer",
      commitmentProgress(),
    );
    await userEvent.click(screen.getByRole("link", { name: "Open detail" }));
    expect(await screen.findByRole("heading", { name: "Leer" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("heading", { name: /Hola, Victor/ })).toBeInTheDocument();
  });

  it("does not redirect an authorized historical season through a newer open pact", async () => {
    progressApp(
      MEMBER,
      activeSeasonProgress(),
      pairCircleFixture({ ...CURRENT, id: "new-season", phase: "pactOpen", week: null }),
    );
    expect(await screen.findByRole("heading", { name: "Andrea" })).toBeInTheDocument();
    expect(screen.queryByText("No pudimos cargar la temporada.")).not.toBeInTheDocument();
  });
});
