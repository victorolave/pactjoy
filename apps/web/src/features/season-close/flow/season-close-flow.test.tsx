import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { SeasonDto } from "../../../ports/wire.ts";
import { pairCircleFixture } from "../../../testing/fixtures/circle.ts";
import { pendingReviewFixture } from "../../../testing/fixtures/review.ts";
import {
  DIBUJAR,
  GYM,
  INGLES,
  LEER,
  resultsFixture,
  submittedClosureFixture,
} from "../../../testing/fixtures/season-close.ts";
import { activeSeasonProgress } from "../../../testing/fixtures/season-progress.ts";
import { activeTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const PATH = "/season/season-1/close";

/** The season's standings as screen 36 shows them: Andrea 798, Victor (the viewer) 792. */
const finalProgress = () => {
  const base = activeSeasonProgress();
  const [first, second] = base.standings.rows;
  if (first === undefined || second === undefined) throw new Error("the fixture has a pair");
  const andrea = first.displayName === "Andrea" ? first : second;
  const victor = first.displayName === "Andrea" ? second : first;
  return {
    ...base,
    standings: {
      ...base.standings,
      rows: [
        { ...andrea, points: 798, rank: 1 },
        { ...victor, points: 792, rank: 2 },
      ],
    },
  };
};

const open = (
  results = resultsFixture(),
  options: Parameters<typeof renderApp>[0] = {},
  path = PATH,
) => {
  const app = renderApp({ path, ...options });
  app.deps.api.setSeasonResults(results);
  app.deps.api.progress.setSeasonProgress("season-1", finalProgress());
  return app;
};

const click = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const choose = (label: string) => userEvent.click(screen.getByRole("radio", { name: label }));

/** Walks the four habits choosing `decisions` in order and presses the last button. */
async function decideAll(decisions: readonly string[], confirm = true) {
  await userEvent.click(
    await screen.findByRole("button", { name: "Decidir qué sigue con cada hábito" }),
  );
  for (const [index, decision] of decisions.entries()) {
    await screen.findByText(`Hábito ${index + 1} de ${decisions.length}`);
    await choose(decision);
    const last = index === decisions.length - 1;
    await click(last ? "Guardar decisiones" : "Continuar");
    if (decision.startsWith("Graduar") && confirm) await click("Sí, graduarlo");
  }
}

const NO_GRADUATION = ["Continuar", "Continuar", "Continuar", "Ajustar"] as const;

describe("36 Resultados", () => {
  // The test's own budget stays above the heading's 5 s wait, so the wait, not vitest, reports a miss.
  it("shows the season's final figures, privately, before anything is decided", {
    timeout: 15_000,
  }, async () => {
    open();
    // The first cold render of the file (imports, route, queries) can near the 1 s default on a loaded CI.
    expect(
      await screen.findByRole("heading", { name: "Cerramos esta temporada" }, { timeout: 5000 }),
    ).toBeVisible();
    expect(screen.getByText("25 ago – 19 oct")).toBeInTheDocument();
    expect(screen.getByText("8 semanas. Cada uno con sus metas.")).toBeInTheDocument();
    const stats = screen.getByRole("region", { name: "Tus cifras de la temporada" });
    expect(within(stats).getByText("Puntos").nextSibling).toHaveTextContent("792");
    expect(within(stats).getByText("Consistencia").nextSibling).toHaveTextContent("85 %");
    expect(within(stats).getByText("Ideal").nextSibling).toHaveTextContent("79 %");
    expect(screen.getByText("Automaticidad")).toBeInTheDocument();
    expect(screen.getByText("inicio → cierre · 1–7")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Leer: 3,5 → 5,8" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Gym: 2 → 2,8" })).toBeInTheDocument();
    expect(screen.getByText("Privado. Solo tú ves estas cifras.")).toBeInTheDocument();
    expect(screen.getByText("Clasificación final")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Clasificación final" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("1");
    expect(first).toHaveTextContent("Andrea");
    expect(first).toHaveTextContent("798 pts");
    expect(second).toHaveTextContent("2");
    expect(second).toHaveTextContent("Victor");
    expect(second).toHaveTextContent("792 pts");
    expect(
      screen.getByText("6 pts de diferencia. Fue una temporada muy pareja."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Puesto 2 de 2/)).not.toBeInTheDocument();
  });

  it("reads nothing about the graduation audience before a habit is graduated", async () => {
    const app = open();
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
    expect(app.deps.api.calls.getSeason).toBe(0);
  });

  it("has no standings and no talk of the others for a solo circle", async () => {
    open(resultsFixture({ standings: { rank: 1, memberCount: 1, gap: null } }));
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
    expect(screen.getByText("8 semanas.")).toBeInTheDocument();
    expect(screen.queryByText("Clasificación final")).not.toBeInTheDocument();
  });

  it("hides the automaticity card until the closing review gives a score", async () => {
    open(
      resultsFixture({
        closingReviewDone: false,
        commitments: resultsFixture().commitments.map((c) => ({
          ...c,
          automaticity: { from: c.automaticity.from, to: null },
        })),
      }),
    );
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
    expect(screen.queryByText("Automaticidad")).not.toBeInTheDocument();
  });

  it("sends the member to the closing review first when it is not done", async () => {
    const app = open(resultsFixture({ closingReviewDone: false }), {
      today: {
        ...activeTodayFixture(),
        pendingReview: pendingReviewFixture({ kind: "closing", periodIndex: 4, dueUntil: null }),
      } as ReturnType<typeof activeTodayFixture>,
    });
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
    expect(
      screen.queryByRole("button", { name: "Decidir qué sigue con cada hábito" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(app.deps.api.calls.getToday).toBeGreaterThan(0));
    // Let Today's answer reach the screen before pressing: the target comes from it.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await click("Hacer la revisión de cierre");
    await waitFor(() => expect(app.location()).toBe("/review/season-1/4"));
  });

  it("leaves for Today with Volver", async () => {
    const app = open();
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
    await click("Volver");
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("shows a skeleton while it loads and announces it", async () => {
    const app = renderApp({ path: PATH });
    app.deps.api.setSeasonResults(resultsFixture());
    expect(screen.getByRole("status", { name: "Cargando tus resultados" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
  });
});

describe("37 Decisión por hábito", () => {
  it("shows one habit at a time with its stage and figures, and no choice made for the member", async () => {
    open();
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
    await click("Decidir qué sigue con cada hábito");
    expect(await screen.findByText("Hábito 1 de 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Leer" })).toBeInTheDocument();
    expect(screen.getByText("🌳 Integrado")).toBeInTheDocument();
    expect(screen.getByText("Consistencia 88 % · automaticidad 5,8")).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Qué hacer con este hábito" });
    expect(within(group).getAllByRole("radio")).toHaveLength(4);
    for (const radio of within(group).getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(screen.getByText("Mismo compromiso en la próxima temporada.")).toBeInTheDocument();
    expect(screen.getByText("Dejarlo fuera de la próxima temporada.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("walks every habit and sends ONE request with all the decisions", async () => {
    const app = open();
    await decideAll(NO_GRADUATION);
    await screen.findByRole("heading", { name: "Decisiones guardadas." });
    expect(app.deps.api.closureCommands).toEqual([
      {
        seasonId: "season-1",
        cmd: {
          decisions: [
            { commitmentId: LEER, decision: "continue" },
            { commitmentId: INGLES, decision: "continue" },
            { commitmentId: DIBUJAR, decision: "continue" },
            { commitmentId: GYM, decision: "adjust" },
          ],
        },
      },
    ]);
  });

  it("says on the last habit that saving is final, and names the button for it", async () => {
    open();
    await click_(await screen.findByRole("button", { name: "Decidir qué sigue con cada hábito" }));
    for (const decision of ["Continuar", "Continuar", "Continuar"]) {
      await choose(decision);
      await click("Continuar");
    }
    expect(await screen.findByText("Hábito 4 de 4")).toBeInTheDocument();
    expect(
      screen.getByText("Después de guardar no podrás cambiar estas decisiones."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Guardar decisiones" })).toBeDisabled();
  });

  it("goes back a habit with its choice kept, and from the first habit to the results", async () => {
    const app = open();
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
    await click("Decidir qué sigue con cada hábito");
    await choose("Pausar");
    await click("Continuar");
    await screen.findByText("Hábito 2 de 4");
    await click("Volver");
    await screen.findByText("Hábito 1 de 4");
    expect(screen.getByRole("radio", { name: "Pausar" })).toBeChecked();
    await click("Volver");
    expect(await screen.findByRole("heading", { name: "Cerramos esta temporada" })).toBeVisible();
    expect(app.deps.api.closureCommands).toEqual([]);
  });

  it("stores nothing when the member leaves before the last habit (REQ-C4)", async () => {
    const app = open();
    await click_(await screen.findByRole("button", { name: "Decidir qué sigue con cada hábito" }));
    await choose("Continuar");
    await click("Continuar");
    await screen.findByText("Hábito 2 de 4");
    app.unmount();
    expect(app.deps.api.calls.submitSeasonClosure).toBe(0);
  });

  it("does not save offline", async () => {
    open(resultsFixture(), { online: false });
    await click_(await screen.findByRole("button", { name: "Decidir qué sigue con cada hábito" }));
    for (const decision of ["Continuar", "Continuar", "Continuar"]) {
      await choose(decision);
      await click("Continuar");
    }
    await choose("Continuar");
    expect(screen.getByRole("button", { name: "Guardar decisiones" })).toBeDisabled();
  });

  it("keeps the decisions and offers to try again when saving fails", async () => {
    const app = open();
    app.deps.api.failNext("submitSeasonClosure", new ApiError("NetworkError", 0, null));
    await decideAll(NO_GRADUATION);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos guardar tus decisiones. Revisa tu conexión.",
    );
    expect(screen.getByText("Hábito 4 de 4")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ajustar" })).toBeChecked();
    await click("Guardar decisiones");
    await screen.findByRole("heading", { name: "Decisiones guardadas." });
    expect(app.deps.api.closureCommands).toHaveLength(2);
  });

  it("disables the button while saving and says so", async () => {
    const app = open();
    const release = app.deps.api.hold("submitSeasonClosure");
    await decideAll(NO_GRADUATION);
    expect(await screen.findByRole("button", { name: "Guardando" })).toBeDisabled();
    release();
    await screen.findByRole("heading", { name: "Decisiones guardadas." });
  });
});

describe("38a and 38b, graduating", () => {
  it("asks first, and 'Todavía no' drops the graduation without moving on", async () => {
    const app = open();
    await click_(await screen.findByRole("button", { name: "Decidir qué sigue con cada hábito" }));
    await choose("Graduar 🎓");
    await click("Continuar");
    const sheet = await screen.findByRole("dialog", { name: "Graduar Leer" });
    expect(
      within(sheet).getByRole("heading", {
        name: "¿Sientes que este hábito ya forma parte de tu rutina?",
      }),
    ).toBeInTheDocument();
    expect(within(sheet).getByText(/La decisión es definitiva\./)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Todavía no" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Hábito 1 de 4")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Graduar 🎓" })).not.toBeChecked();
    expect(app.deps.api.closureCommands).toEqual([]);
  });

  it("'Sí, graduarlo' moves on, and nothing is sent until the last habit", async () => {
    const app = open();
    await click_(await screen.findByRole("button", { name: "Decidir qué sigue con cada hábito" }));
    await choose("Graduar 🎓");
    await click("Continuar");
    await click("Sí, graduarlo");
    expect(await screen.findByText("Hábito 2 de 4")).toBeInTheDocument();
    expect(app.deps.api.closureCommands).toEqual([]);
  });

  it("celebrates the graduated habit after saving, then shows the summary", async () => {
    const app = open();
    app.deps.api.setClosureResult(
      submittedClosureFixture({ seasonClosed: false, graduatedHabitIds: ["habit-leer"] }),
    );
    await decideAll(["Graduar 🎓", "Continuar", "Continuar", "Ajustar"]);
    expect(await screen.findByRole("heading", { name: "Graduaste Leer" })).toBeVisible();
    expect(
      screen.getByText(
        "8 semanas, 88 % de consistencia y ya no necesitas llevar la cuenta. Ahora es parte de tu rutina.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Solo tú ves esta decisión.")).not.toBeInTheDocument();
    await click("Continuar");
    expect(await screen.findByRole("heading", { name: "Decisiones guardadas." })).toBeVisible();
  });

  describe("tells the member what the circle will read about the graduation (ADR-0018)", () => {
    const seasonWith = (privacy: "visible" | "private") =>
      ({
        id: "season-1",
        commitments: [
          {
            kind: "detail",
            id: LEER,
            memberId: "member-victor",
            habitId: "habit-leer",
            weightPercent: 25,
            privacy,
          },
        ],
      }) as unknown as SeasonDto;

    const graduateLeer = async (privacy: "visible" | "private" | null) => {
      const app = open(resultsFixture(), { myCircle: pairCircleFixture() });
      if (privacy !== null) app.deps.api.setPactResponse("getSeason", seasonWith(privacy));
      app.deps.api.setClosureResult(
        submittedClosureFixture({ seasonClosed: false, graduatedHabitIds: ["habit-leer"] }),
      );
      await decideAll(["Graduar 🎓", "Continuar", "Continuar", "Ajustar"]);
      await screen.findByRole("heading", { name: "Graduaste Leer" });
      return app;
    };

    it("names the peer and what they will read, as the design does", async () => {
      await graduateLeer("visible");
      expect(
        await screen.findByText("Andrea verá “Victor graduó Leer” en la actividad del círculo."),
      ).toBeInTheDocument();
    });

    it("never names a private habit", async () => {
      await graduateLeer("private");
      expect(
        await screen.findByText("Tu círculo verá que graduaste un objetivo privado."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/graduó Leer/)).not.toBeInTheDocument();
    });

    it("says neither line while it is still reading whether the habit is private", async () => {
      const app = open(resultsFixture(), { myCircle: pairCircleFixture() });
      app.deps.api.setPactResponse("getSeason", seasonWith("visible"));
      const release = app.deps.api.hold("getSeason");
      app.deps.api.setClosureResult(
        submittedClosureFixture({ seasonClosed: false, graduatedHabitIds: ["habit-leer"] }),
      );
      await decideAll(["Graduar 🎓", "Continuar", "Continuar", "Ajustar"]);
      await screen.findByRole("heading", { name: "Graduaste Leer" });
      await waitFor(() => expect(app.deps.api.calls.getSeason).toBe(1));
      expect(screen.queryByText(/objetivo privado/)).not.toBeInTheDocument();
      expect(screen.queryByText(/graduó Leer/)).not.toBeInTheDocument();
      await act(async () => release());
      expect(
        await screen.findByText("Andrea verá “Victor graduó Leer” en la actividad del círculo."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/objetivo privado/)).not.toBeInTheDocument();
    });

    it("does not name the habit while it cannot tell whether it is private", async () => {
      await graduateLeer(null);
      expect(
        await screen.findByText("Tu círculo verá que graduaste un objetivo privado."),
      ).toBeInTheDocument();
    });
  });

  it("celebrates each graduated habit in order, with 'Siguiente hábito' between them", async () => {
    open();
    await decideAll(["Graduar 🎓", "Continuar", "Graduar 🎓", "Ajustar"]);
    await screen.findByRole("heading", { name: "Graduaste Leer" });
    await click("Siguiente hábito");
    expect(await screen.findByRole("heading", { name: "Graduaste Dibujar" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Siguiente hábito" })).not.toBeInTheDocument();
    await click("Continuar");
    await screen.findByRole("heading", { name: "Decisiones guardadas." });
  });
});

describe("37b Decisiones guardadas", () => {
  it("lists every decision with its badge, 'Pausar' without the word pausa", async () => {
    open();
    await decideAll(["Graduar 🎓", "Continuar", "Pausar", "Ajustar"]);
    await click("Continuar"); // the celebration of Leer
    const list = await screen.findByRole("list", { name: "Tus decisiones" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Leer🎓 Graduado",
      "InglésContinuar",
      "DibujarQueda fuera",
      "GymAjustar",
    ]);
    expect(list.textContent).not.toMatch(/pausa/i);
  });

  it("offers the next season once the circle may open it", async () => {
    const app = open();
    app.deps.api.setClosureResult(
      submittedClosureFixture({ seasonClosed: true, graduatedHabitIds: [] }),
    );
    await decideAll(NO_GRADUATION);
    expect(await screen.findByText(/preparamos la siguiente temporada/)).toBeInTheDocument();
    await click("Preparar la siguiente temporada");
    await waitFor(() => expect(app.location()).toBe("/season/new"));
  });

  it("waits for the circle when it cannot open the next season yet", async () => {
    const app = open(resultsFixture(), {
      myCircle: pairCircleFixture({
        id: "season-1",
        phase: "ended",
        lengthWeeks: 8,
        week: 8,
        approvalCount: 2,
        nextSeasonOpen: false,
      }),
    });
    await decideAll(NO_GRADUATION);
    expect(
      await screen.findByText(
        "Cuando todo tu círculo cierre, podrán preparar la siguiente temporada.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preparar la siguiente temporada" }),
    ).not.toBeInTheDocument();
    await click("Ir a Hoy");
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("refreshes Today and the circle after saving, so neither shows the old state", async () => {
    const app = open();
    await screen.findByRole("heading", { name: "Cerramos esta temporada" });
    await waitFor(() => expect(app.deps.api.calls.getToday).toBeGreaterThan(0));
    const before = app.deps.api.calls.getToday;
    await decideAll(NO_GRADUATION);
    await screen.findByRole("heading", { name: "Decisiones guardadas." });
    await waitFor(() => expect(app.deps.api.calls.getToday).toBeGreaterThan(before));
  });
});

describe("states of the route", () => {
  it("shows an already saved closure as saved, read-only, with no form", async () => {
    open(
      resultsFixture({
        closure: submittedClosureFixture(),
        status: "closed",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Decisiones guardadas." })).toBeVisible();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Graduaste/ })).not.toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Tus decisiones" })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(4);
  });

  it("refetches and shows the saved decisions when the closure was already submitted", async () => {
    const app = open();
    app.deps.api.failNext(
      "submitSeasonClosure",
      new ApiError("ClosureAlreadySubmitted", 409, null),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Decidir qué sigue con cada hábito" }),
    );
    for (const decision of ["Continuar", "Continuar", "Continuar"]) {
      await choose(decision);
      await click("Continuar");
    }
    await choose("Ajustar");
    // Meanwhile another device saved the closure: the next read of the results shows it.
    app.deps.api.setSeasonResults(resultsFixture({ closure: submittedClosureFixture() }));
    await click("Guardar decisiones");
    expect(await screen.findByRole("heading", { name: "Decisiones guardadas." })).toBeVisible();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(app.deps.api.calls.getSeasonResults).toBeGreaterThan(1);
  });

  it("names the day when the results are not open yet", async () => {
    const app = renderApp({ path: PATH });
    app.deps.api.failNext(
      "getSeasonResults",
      new ApiError("SeasonResultsNotYet", 409, null, { availableOn: "2026-10-21" }),
    );
    expect(
      await screen.findByText("Tus resultados estarán listos el miércoles 21 de octubre."),
    ).toBeInTheDocument();
    await click("Volver a Hoy");
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("says the season is already closed when saving is too late", async () => {
    const app = open();
    app.deps.api.failNext("submitSeasonClosure", new ApiError("SeasonNotActive", 409, null));
    await decideAll(NO_GRADUATION);
    expect(await screen.findByText("La temporada ya se cerró.")).toBeInTheDocument();
    expect(screen.queryByText("Hábito 4 de 4")).not.toBeInTheDocument();
  });

  it("sends the member to the closing review when saving needs it", async () => {
    const app = open(resultsFixture(), {
      today: {
        ...activeTodayFixture(),
        pendingReview: pendingReviewFixture({ kind: "closing", periodIndex: 4, dueUntil: null }),
      } as ReturnType<typeof activeTodayFixture>,
    });
    app.deps.api.failNext("submitSeasonClosure", new ApiError("ClosingReviewRequired", 409, null));
    await decideAll(NO_GRADUATION);
    expect(
      await screen.findByText("Antes de decidir, haz tu revisión de cierre."),
    ).toBeInTheDocument();
    await click("Hacer la revisión de cierre");
    await waitFor(() => expect(app.location()).toBe("/review/season-1/4"));
  });

  it("offers a retry when the results cannot be loaded", async () => {
    const app = renderApp({ path: PATH });
    app.deps.api.failNext("getSeasonResults", new ApiError("NetworkError", 0, null));
    app.deps.api.setSeasonResults(resultsFixture());
    expect(
      await screen.findByText("No pudimos cargar tus resultados. Revisa tu conexión."),
    ).toBeInTheDocument();
    await click("Reintentar");
    expect(await screen.findByRole("heading", { name: "Cerramos esta temporada" })).toBeVisible();
  });

  it("says a member with nothing to close has nothing to decide", async () => {
    const app = renderApp({ path: PATH });
    app.deps.api.failNext("getSeasonResults", new ApiError("NothingToClose", 409, null));
    expect(
      await screen.findByText(
        "No tenías compromisos esta temporada, así que no hay nada que decidir.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the design illustrations", () => {
  it("draws the designed picture on the decisions-saved screen", async () => {
    open();
    await decideAll(NO_GRADUATION);
    const picture = await screen.findByRole("img", {
      name: "Dos personas chocan las manos en alto",
    });
    expect(picture).toHaveAttribute("src", expect.stringContaining("celebrar-juntos"));
  });

  it("draws the designed picture on the graduation question", async () => {
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Decidir qué sigue con cada hábito" }),
    );
    await choose("Graduar 🎓");
    await click("Continuar");
    const picture = await screen.findByRole("img", {
      name: "Un hombre camina tranquilo con un libro junto a una planta",
    });
    expect(picture).toHaveAttribute("src", expect.stringContaining("graduar-habito"));
  });
});

describe("the read-only results route", () => {
  it("shows screen 36 for a closed season with no way to decide", async () => {
    const app = open(
      resultsFixture({ status: "closed", closure: submittedClosureFixture() }),
      {},
      "/season/season-1/results",
    );
    expect(await screen.findByRole("heading", { name: "Cerramos esta temporada" })).toBeVisible();
    expect(await screen.findByRole("list", { name: "Clasificación final" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Decidir|revisión|decisiones/ }),
    ).not.toBeInTheDocument();
    await click("Volver");
    await waitFor(() => expect(app.location()).toBe("/profile"));
  });
});

// A tiny alias so a promise returned by findByRole can be clicked in one line.
const click_ = (button: HTMLElement) => userEvent.click(button);
