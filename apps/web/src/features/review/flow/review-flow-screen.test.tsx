import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { ReviewDraftDto } from "../../../ports/wire.ts";
import { todayKey } from "../../../shared/query-keys.ts";
import {
  baselineFixture,
  closingFixture,
  DIBUJAR,
  GYM,
  INGLES,
  interimFullFixture,
  interimItemOneFixture,
  LEER,
  submittedFixture,
} from "../../../testing/fixtures/review.ts";
import { renderApp } from "../../../testing/render.tsx";

const open = (draft: ReviewDraftDto, period = 2, options = {}) =>
  renderApp({
    path: `/review/season-1/${period}`,
    reviews: [{ seasonId: "season-1", periodIndex: period, draft }],
    ...options,
  });

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }));

/** Presses `score` on the n-th phrase of the screen. */
const answer = (phrase: number, score: number) => {
  const group = screen.getAllByRole("group")[phrase] as HTMLElement;
  return userEvent.click(within(group).getByRole("button", { name: String(score) }));
};

async function answerAllItems(score: number) {
  for (const phrase of [0, 1, 2, 3]) await answer(phrase, score);
}

describe("the review route", () => {
  it("walks an item-1 review: summary, reflection, one screen of questions, saved", async () => {
    const app = open(interimItemOneFixture());
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await userEvent.type(screen.getByLabelText("¿Qué te ayudó?"), "Leer de noche");
    await click("Continuar");

    await screen.findByRole("heading", { name: "¿Cuánto te identificas con esta frase?" });
    expect(screen.getByRole("button", { name: "Terminar revisión" })).toBeDisabled();
    for (const phrase of [0, 1, 2, 3]) await answer(phrase, phrase + 3);
    await click("Terminar revisión");

    await screen.findByRole("heading", { name: "Revisión guardada." });
    expect(app.deps.api.reviewCommands).toEqual([
      {
        method: "submitReview",
        args: [
          "season-1",
          2,
          {
            reflection: { helped: "Leer de noche", hard: null },
            automaticity: [
              { commitmentId: LEER, items: [3, null, null, null] },
              { commitmentId: INGLES, items: [4, null, null, null] },
              { commitmentId: DIBUJAR, items: [5, null, null, null] },
              { commitmentId: GYM, items: [6, null, null, null] },
            ],
          },
        ],
      },
    ]);
  });

  it("tags the paused commitment on the item-1 screen", async () => {
    open(interimItemOneFixture());
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await click("Continuar");
    expect(
      await screen.findByText("Gym es algo que hago automáticamente. (en pausa)"),
    ).toBeInTheDocument();
  });

  it("'Saltar' skips only the reflection and the questions still follow", async () => {
    const app = open(interimItemOneFixture());
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await userEvent.type(screen.getByLabelText("¿Qué te ayudó?"), "se borra");
    await click("Saltar");
    await screen.findByRole("heading", { name: "¿Cuánto te identificas con esta frase?" });
    for (const phrase of [0, 1, 2, 3]) await answer(phrase, 4);
    await click("Terminar revisión");
    await screen.findByRole("heading", { name: "Revisión guardada." });
    const [command] = app.deps.api.reviewCommands;
    expect(command?.args[2]).toMatchObject({ reflection: { helped: null, hard: null } });
  });

  it("walks a full review one commitment per screen and sends four slots each", async () => {
    const app = open(interimFullFixture());
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await click("Saltar");
    await screen.findByText("Compromiso 1 de 4 · Leer");
    await answerAllItems(5);
    await click("Siguiente: Inglés");
    await screen.findByText("Compromiso 2 de 4 · Inglés");
    await answerAllItems(4);
    await click("Siguiente: Dibujar");
    await answerAllItems(3);
    await click("Siguiente: Gym");
    await screen.findByText("Compromiso 4 de 4 · Gym");
    await answerAllItems(2);
    await click("Terminar revisión");
    await screen.findByRole("heading", { name: "Revisión guardada." });
    expect(app.deps.api.reviewCommands[0]?.args[2]).toMatchObject({
      automaticity: [
        { commitmentId: LEER, items: [5, 5, 5, 5] },
        { commitmentId: INGLES, items: [4, 4, 4, 4] },
        { commitmentId: DIBUJAR, items: [3, 3, 3, 3] },
        { commitmentId: GYM, items: [2, 2, 2, 2] },
      ],
    });
  });

  it("goes back a commitment without losing its answers", async () => {
    open(interimFullFixture());
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await click("Saltar");
    await answerAllItems(6);
    await click("Siguiente: Inglés");
    await screen.findByText("Compromiso 2 de 4 · Inglés");
    await click("Volver");
    await screen.findByText("Compromiso 1 de 4 · Leer");
    const first = screen.getAllByRole("group")[0] as HTMLElement;
    expect(within(first).getByRole("button", { name: "6" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("starts the baseline on the questions, with no summary and no reflection", async () => {
    const app = open(baselineFixture(), 0);
    await screen.findByText("Compromiso 1 de 4 · Leer");
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    await answerAllItems(4);
    await click("Siguiente: Inglés");
    await answerAllItems(4);
    await click("Siguiente: Dibujar");
    await answerAllItems(4);
    await click("Siguiente: Gym");
    await answerAllItems(4);
    await click("Terminar revisión");
    await screen.findByRole("heading", { name: "Revisión guardada." });
    expect(app.deps.api.reviewCommands[0]?.args.slice(0, 2)).toEqual(["season-1", 0]);
    expect(app.deps.api.reviewCommands[0]?.args[2]).toMatchObject({
      reflection: { helped: null, hard: null },
    });
  });

  it("closing with X leaves for Today and saves nothing", async () => {
    const app = open(interimItemOneFixture());
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Cerrar");
    await waitFor(() => expect(app.location()).toBe("/"));
    expect(app.deps.api.reviewCommands).toEqual([]);
  });

  it("names the improvements and the next review on the saved screen, then goes to Today", async () => {
    const app = open(interimItemOneFixture(), 2);
    app.deps.api.setSubmitResult(
      submittedFixture({
        improvements: [{ commitmentId: LEER, from: "3,5", to: "4,5" }],
        nextReviewDate: "2026-10-20",
      }),
    );
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await click("Saltar");
    for (const phrase of [0, 1, 2, 3]) await answer(phrase, 5);
    await click("Terminar revisión");
    expect(
      await screen.findByText(
        "Leer se siente más automático que al empezar (de 3,5 a 4,5). La próxima revisión es el martes 20 de octubre.",
      ),
    ).toBeInTheDocument();
    await click("Seguir con mi día");
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("marks Today stale after saving, so the card goes away", async () => {
    const app = open(interimItemOneFixture());
    app.deps.queryClient.setQueryData(todayKey, await app.deps.api.getToday());
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await click("Saltar");
    for (const phrase of [0, 1, 2, 3]) await answer(phrase, 5);
    await click("Terminar revisión");
    await screen.findByRole("heading", { name: "Revisión guardada." });
    expect(app.deps.queryClient.getQueryState(todayKey)?.isInvalidated).toBe(true);
  });
});

describe("the review route, when it cannot be answered", () => {
  it.each([
    ["upcoming", "Esta revisión todavía no está disponible."],
    ["lapsed", "Esta revisión ya pasó. La próxima te llegará a su hora."],
  ] as const)("says a %s review is not available and offers Today", async (status, message) => {
    const app = open(interimItemOneFixture({ status }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    await click("Volver a Hoy");
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("shows an already saved review as saved, not as a form", async () => {
    open(interimItemOneFixture({ status: "completed" }));
    expect(await screen.findByRole("heading", { name: "Revisión guardada." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
  });

  it("sends the closing review back to Today: it has no screen in this change", async () => {
    const app = open(closingFixture());
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("says a period that does not exist is not found", async () => {
    renderApp({ path: "/review/season-1/9" });
    expect(await screen.findByText("No encontramos esta revisión.")).toBeInTheDocument();
  });

  it("offers a retry when the draft cannot be loaded, and shows the review after it", async () => {
    const app = open(interimItemOneFixture(), 2, {
      reviewFailures: [new ApiError("NetworkError", 0, null)],
    });
    expect(
      await screen.findByText("No pudimos cargar tu revisión. Revisa tu conexión."),
    ).toBeInTheDocument();
    await click("Reintentar");
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    expect(app.deps.api.calls.getReview).toBe(2);
  });

  it("goes to Today for a path that is not a period number", async () => {
    const app = renderApp({ path: "/review/season-1/abc" });
    await waitFor(() => expect(app.location()).toBe("/"));
  });
});

describe("the review route, when saving fails", () => {
  async function toLastScreen(app: ReturnType<typeof open>) {
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await userEvent.type(screen.getByLabelText("¿Qué costó más?"), "El gym");
    await click("Continuar");
    for (const phrase of [0, 1, 2, 3]) await answer(phrase, 5);
    return app;
  }

  it("shows the review as saved when it already was (a second device or a lost race)", async () => {
    const app = await toLastScreen(open(interimItemOneFixture()));
    app.deps.api.failNext("submitReview", new ApiError("ReviewAlreadySubmitted", 409, null));
    await click("Terminar revisión");
    expect(await screen.findByRole("heading", { name: "Revisión guardada." })).toBeInTheDocument();
  });

  it("takes the member back to the field the server complained about", async () => {
    const app = await toLastScreen(open(interimItemOneFixture()));
    app.deps.api.failNext(
      "submitReview",
      new ApiError("NoteTooLong", 422, null, { field: "hard" }),
    );
    await click("Terminar revisión");
    expect(await screen.findByText("Es demasiado largo. Acórtalo un poco.")).toBeInTheDocument();
    expect(screen.getByLabelText("¿Qué costó más?")).toBeInvalid();
    expect(screen.getByLabelText("¿Qué costó más?")).toHaveValue("El gym");
    expect(screen.getByLabelText("¿Qué te ayudó?")).toBeValid();
  });

  it("keeps the answers and says what failed when the network drops, and lets the member retry", async () => {
    const app = await toLastScreen(open(interimItemOneFixture()));
    app.deps.api.failNext("submitReview", new ApiError("NetworkError", 0, null));
    await click("Terminar revisión");
    expect(
      await screen.findByText("No pudimos guardar tu revisión. Revisa tu conexión."),
    ).toBeInTheDocument();
    await click("Terminar revisión");
    await screen.findByRole("heading", { name: "Revisión guardada." });
    expect(app.deps.api.calls.submitReview).toBe(2);
  });

  it("tells the member to check the answers when the server says some are missing", async () => {
    const app = await toLastScreen(open(interimItemOneFixture()));
    app.deps.api.failNext("submitReview", new ApiError("AutomaticityIncomplete", 422, null));
    await click("Terminar revisión");
    expect(
      await screen.findByText("Falta responder alguna frase. Revisa tus respuestas."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "¿Cuánto te identificas con esta frase?" }),
    ).toBeInTheDocument();
  });

  it("explains a review that lapsed meanwhile and goes to Today", async () => {
    const app = await toLastScreen(open(interimItemOneFixture()));
    app.deps.api.failNext(
      "submitReview",
      new ApiError("ReviewNotDue", 409, null, { reason: "lapsed" }),
    );
    await click("Terminar revisión");
    expect(
      await screen.findByText("Esta revisión ya pasó. La próxima te llegará a su hora."),
    ).toBeInTheDocument();
  });

  it("does not let the member save while offline", async () => {
    const app = open(interimItemOneFixture(), 2, { online: false });
    await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" });
    await click("Continuar");
    await click("Saltar");
    for (const phrase of [0, 1, 2, 3]) await answer(phrase, 5);
    expect(screen.getByRole("button", { name: "Terminar revisión" })).toBeDisabled();
    expect(app.deps.api.reviewCommands).toEqual([]);
  });
});
