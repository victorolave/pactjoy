import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { pairCircleFixture, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { myPauseRequestsFixture, pauseBudgetFixture } from "../../../testing/fixtures/pause.ts";
import {
  activeTodayFixture,
  dayRowFixture,
  noSeasonTodayFixture,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { type RenderAppOptions, renderInProviders } from "../../../testing/render.tsx";
import { RequestPauseSheet, type RequestPauseSheetProps } from "./RequestPauseSheet.tsx";

/** Today is 2026-10-02; the season runs 2026-09-28..2026-10-25 (4 weeks). */
async function renderSheet(
  props: Partial<RequestPauseSheetProps> = {},
  options: RenderAppOptions & {
    readonly budgets?: readonly [number, number];
  } = {},
) {
  const { budgets = [14, 14], ...rest } = options;
  const onClose = props.onClose ?? (() => {});
  const view = renderInProviders(<RequestPauseSheet open onClose={onClose} {...props} />, {
    myCircle: pairCircleFixture(),
    ...rest,
  });
  view.deps.api.setMyPauseRequests(
    myPauseRequestsFixture({
      budgets: [
        pauseBudgetFixture({ commitmentId: "commitment-1", remainingDays: budgets[0] }),
        pauseBudgetFixture({ commitmentId: "commitment-2", remainingDays: budgets[1] }),
      ],
    }),
  );
  await view.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
  await screen.findByRole("dialog", { name: "Pausar un compromiso" });
  // Today and the circle load behind a skeleton.
  await waitFor(() => expect(document.querySelector("[aria-busy='true']")).toBeNull());
  return view;
}

const chip = (name: string) => screen.getByRole("button", { name });
const submit = () => screen.getByRole("button", { name: /Enviar solicitud|Pausar ahora/ });
const dateField = (label: string) => screen.getByLabelText(label);

describe("the request sheet (screen 26, PS-1..PS-5)", () => {
  it("offers a chip per Commitment plus Todos, the reasons, Desde, Hasta and a note", async () => {
    await renderSheet();
    expect(screen.getByRole("group", { name: "Compromiso" })).toBeInTheDocument();
    for (const name of ["Meditar", "Leer", "Todos"]) expect(chip(name)).toBeInTheDocument();
    for (const name of ["Salud o lesión", "Viaje", "Trabajo", "Otro"]) {
      expect(chip(name)).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByRole("radio", { name: "Hoy" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Fecha fija" })).toBeChecked();
    expect(screen.getByLabelText("Nota (opcional)")).toBeInTheDocument();
  });

  it("starts on Todos, or on the Commitment the sheet was opened from (PS-1)", async () => {
    const { unmount } = await renderSheet();
    expect(chip("Todos")).toHaveAttribute("aria-pressed", "true");
    unmount();
    await renderSheet({ initialCommitmentId: "commitment-2" });
    expect(chip("Leer")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Todos")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the quota: the smallest across the Commitments for Todos (PL-26, PL-S21)", async () => {
    await renderSheet({}, { budgets: [20, 2] });
    expect(
      screen.getByText("Te quedan 2 días de pausa para todos tus compromisos"),
    ).toBeInTheDocument();
    await userEvent.click(chip("Meditar"));
    expect(screen.getByText("Te quedan 20 días de pausa para Meditar")).toBeInTheDocument();
    await userEvent.click(chip("Leer"));
    expect(screen.getByText("Te quedan 2 días de pausa para Leer")).toBeInTheDocument();
  });

  it("names the approvers and says the request approves itself after 48 h (PS-2)", async () => {
    await renderSheet();
    expect(
      screen.getByText("Lo aprueba Andrea. Si nadie responde en 48 h, se aprueba sola."),
    ).toBeInTheDocument();
    expect(submit()).toHaveTextContent("Enviar solicitud");
  });

  it("has no approval line in a solo circle, and the button says it takes effect now (PS-S4)", async () => {
    await renderSheet({}, { myCircle: soloCircleFixture() });
    expect(screen.queryByText(/se aprueba sola/)).not.toBeInTheDocument();
    expect(submit()).toHaveTextContent("Pausar ahora");
  });

  it("keeps the button off until a reason is chosen", async () => {
    await renderSheet();
    fireEvent.change(dateField("Último día"), { target: { value: "2026-10-04" } });
    expect(submit()).toBeDisabled();
    await userEvent.click(chip("Viaje"));
    expect(submit()).toBeEnabled();
  });

  it("sends Todos from today, fixed to the chosen last day, and closes with a toast (PS-5)", async () => {
    let closed = 0;
    const { deps } = await renderSheet({ onClose: () => closed++ });
    await userEvent.click(chip("Viaje"));
    fireEvent.change(dateField("Último día"), { target: { value: "2026-10-09" } });
    await userEvent.click(submit());
    await waitFor(() => expect(closed).toBe(1));
    expect(deps.api.pauseCommands).toEqual([
      {
        method: "requestPause",
        args: [
          "season-1",
          {
            scope: { kind: "all" },
            reason: "travel",
            note: null,
            startDate: "2026-10-02",
            endDate: "2026-10-09",
          },
        ],
      },
    ]);
    expect(await screen.findByText("Solicitud enviada")).toBeInTheDocument();
  });

  it("sends one Commitment, an open end, a later start and the trimmed note", async () => {
    const { deps } = await renderSheet({ initialCommitmentId: "commitment-1" });
    await userEvent.click(chip("Salud o lesión"));
    await userEvent.click(screen.getByRole("radio", { name: "Otra fecha" }));
    fireEvent.change(dateField("Primer día"), { target: { value: "2026-10-05" } });
    await userEvent.click(screen.getByRole("radio", { name: "Abierta" }));
    await userEvent.type(screen.getByLabelText("Nota (opcional)"), "  Me operan  ");
    await userEvent.click(submit());
    await waitFor(() => expect(deps.api.calls.requestPause).toBe(1));
    expect(deps.api.pauseCommands[0]?.args).toEqual([
      "season-1",
      {
        scope: { kind: "commitment", commitmentId: "commitment-1" },
        reason: "health",
        note: "Me operan",
        startDate: "2026-10-05",
        endDate: null,
      },
    ]);
  });

  it("explains an open end", async () => {
    await renderSheet();
    await userEvent.click(screen.getByRole("radio", { name: "Abierta" }));
    expect(
      screen.getByText("Hasta que la reanudes. No se puede empezar en una fecha pasada."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Último día")).not.toBeInTheDocument();
  });

  it("prefills the start for 'Pedir más días' (PS-13)", async () => {
    const { deps } = await renderSheet({
      initialCommitmentId: "commitment-1",
      initialStart: "2026-10-10",
    });
    expect(screen.getByRole("radio", { name: "Otra fecha" })).toBeChecked();
    expect(dateField("Primer día")).toHaveValue("2026-10-10");
    await userEvent.click(chip("Trabajo"));
    fireEvent.change(dateField("Último día"), { target: { value: "2026-10-12" } });
    await userEvent.click(submit());
    await waitFor(() => expect(deps.api.calls.requestPause).toBe(1));
    expect(deps.api.pauseCommands[0]?.args[1]).toMatchObject({
      startDate: "2026-10-10",
      endDate: "2026-10-12",
    });
  });

  it("does not let the dates go before today or past the season", async () => {
    await renderSheet();
    await userEvent.click(screen.getByRole("radio", { name: "Otra fecha" }));
    expect(dateField("Primer día")).toHaveAttribute("min", "2026-10-03");
    expect(dateField("Primer día")).toHaveAttribute("max", "2026-10-25");
    expect(dateField("Último día")).toHaveAttribute("max", "2026-10-25");
  });

  describe("input checks before sending (PS-3)", () => {
    it("blocks a last day before the first day", async () => {
      const { deps } = await renderSheet();
      await userEvent.click(screen.getByRole("radio", { name: "Otra fecha" }));
      fireEvent.change(dateField("Primer día"), { target: { value: "2026-10-08" } });
      await userEvent.click(chip("Viaje"));
      fireEvent.change(dateField("Último día"), { target: { value: "2026-10-06" } });
      expect(
        screen.getByText("El último día no puede ser anterior al primero."),
      ).toBeInTheDocument();
      expect(submit()).toBeDisabled();
      expect(deps.api.calls.requestPause).toBe(0);
    });

    it("blocks a fixed end that needs more days than the quota", async () => {
      await renderSheet({ initialCommitmentId: "commitment-2" }, { budgets: [14, 3] });
      await userEvent.click(chip("Viaje"));
      fireEvent.change(dateField("Último día"), { target: { value: "2026-10-05" } });
      expect(screen.getByText("Son 4 días y solo te quedan 3 para Leer.")).toBeInTheDocument();
      expect(submit()).toBeDisabled();
      fireEvent.change(dateField("Último día"), { target: { value: "2026-10-04" } });
      expect(submit()).toBeEnabled();
    });

    it("blocks everything when no day is left", async () => {
      await renderSheet({ initialCommitmentId: "commitment-2" }, { budgets: [14, 0] });
      await userEvent.click(chip("Viaje"));
      expect(screen.getByText("No te quedan días de pausa para Leer.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("radio", { name: "Abierta" }));
      expect(submit()).toBeDisabled();
    });

    it("needs a last day when the end is fixed, but not when it is open", async () => {
      await renderSheet();
      await userEvent.click(chip("Viaje"));
      expect(submit()).toBeDisabled();
      fireEvent.change(dateField("Último día"), { target: { value: "2026-10-04" } });
      expect(submit()).toBeEnabled();
      fireEvent.change(dateField("Último día"), { target: { value: "" } });
      expect(submit()).toBeDisabled();
      await userEvent.click(screen.getByRole("radio", { name: "Abierta" }));
      expect(submit()).toBeEnabled();
    });

    it("needs a first day when the start is another date", async () => {
      await renderSheet();
      await userEvent.click(chip("Viaje"));
      await userEvent.click(screen.getByRole("radio", { name: "Abierta" }));
      await userEvent.click(screen.getByRole("radio", { name: "Otra fecha" }));
      expect(submit()).toBeDisabled();
      fireEvent.change(dateField("Primer día"), { target: { value: "2026-10-03" } });
      expect(submit()).toBeEnabled();
      fireEvent.change(dateField("Primer día"), { target: { value: "2026-10-01" } });
      expect(
        screen.getByText("Elige un día entre mañana y el final de la temporada."),
      ).toBeInTheDocument();
      expect(submit()).toBeDisabled();
    });
  });

  describe("private Commitments (PS-4, PS-S5)", () => {
    const privateToday = () =>
      activeTodayFixture({
        rows: [dayRowFixture({ privacy: "private" }), weekRowFixture()],
      });

    it("warns that the circle will read the note when a private Commitment is covered", async () => {
      await renderSheet({ initialCommitmentId: "commitment-1" }, { today: privateToday() });
      expect(
        screen.getByText("Meditar es privado, pero el círculo verá esta nota."),
      ).toBeInTheDocument();
      await userEvent.click(chip("Leer"));
      expect(screen.queryByText(/es privado/)).not.toBeInTheDocument();
      await userEvent.click(chip("Todos"));
      expect(screen.getByText(/pero el círculo verá esta nota/)).toBeInTheDocument();
    });

    it("says nothing about privacy when every covered Commitment is visible", async () => {
      await renderSheet();
      expect(screen.queryByText(/pero el círculo verá esta nota/)).not.toBeInTheDocument();
      expect(screen.getByText("El círculo verá la nota que escribas.")).toBeInTheDocument();
    });
  });

  describe("server errors keep everything the user typed (PS-3)", () => {
    async function fillAndFail(error: ApiError) {
      const view = await renderSheet({ initialCommitmentId: "commitment-1" });
      view.deps.api.failNext("requestPause", error);
      await userEvent.click(chip("Viaje"));
      await userEvent.type(screen.getByLabelText("Nota (opcional)"), "De viaje");
      fireEvent.change(dateField("Último día"), { target: { value: "2026-10-04" } });
      await userEvent.click(submit());
      return view;
    }

    it("lists the Commitments over their cap, with their days left, for PauseCapExceeded", async () => {
      await fillAndFail(
        new ApiError("PauseCapExceeded", 409, null, {
          commitments: [
            { commitmentId: "commitment-1", reason: "exceedsRemainingCap", remainingDays: 2 },
            { commitmentId: "commitment-2", reason: "capExhausted", remainingDays: 0 },
          ],
        }),
      );
      expect(
        await screen.findByText("Superas los días de pausa que te quedan."),
      ).toBeInTheDocument();
      expect(screen.getByText("Meditar: te quedan 2 días")).toBeInTheDocument();
      expect(screen.getByText("Leer: no te quedan días")).toBeInTheDocument();
      expect(chip("Viaje")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("De viaje");
      expect(dateField("Último día")).toHaveValue("2026-10-04");
    });

    it("names the Commitments that already have a pause, for PauseOverlaps", async () => {
      await fillAndFail(
        new ApiError("PauseOverlaps", 409, null, { commitmentIds: ["commitment-1"] }),
      );
      expect(
        await screen.findByText("Ya hay una pausa que se cruza con esas fechas."),
      ).toBeInTheDocument();
      expect(within(screen.getByRole("alert")).getByText("Meditar")).toBeInTheDocument();
    });

    it.each([
      ["PauseRetroactive", 422, "La pausa no puede empezar en un día pasado."],
      ["PauseEndsAfterSeason", 422, "La pausa no puede pasar del último día de la temporada."],
      ["SeasonNotActive", 409, "La temporada no está activa."],
    ])("shows %s", async (code, status, message) => {
      await fillAndFail(new ApiError(code, status, null));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("lets the user send again after a failure", async () => {
      const { deps } = await fillAndFail(new ApiError("NetworkError", 0, null));
      expect(
        await screen.findByText("No pudimos enviar la solicitud. Revisa tu conexión."),
      ).toBeInTheDocument();
      await userEvent.click(submit());
      await waitFor(() => expect(deps.api.calls.requestPause).toBe(2));
    });
  });

  it("cannot be sent without a connection (no write queue)", async () => {
    await renderSheet({}, { online: false });
    await userEvent.click(chip("Viaje"));
    expect(submit()).toBeDisabled();
    expect(
      screen.getByText("Sin conexión: vuelve a conectarte para enviar la solicitud."),
    ).toBeInTheDocument();
  });

  it("cannot be sent twice while the request is in flight", async () => {
    const { deps } = await renderSheet();
    const release = deps.api.hold("requestPause");
    await userEvent.click(chip("Viaje"));
    fireEvent.change(dateField("Último día"), { target: { value: "2026-10-04" } });
    await userEvent.click(submit());
    expect(submit()).toBeDisabled();
    release();
    await waitFor(() => expect(deps.api.calls.requestPause).toBe(1));
  });

  it("says so when there is no active season", async () => {
    await renderSheet({}, { today: noSeasonTodayFixture() });
    expect(screen.getByText("No hay una temporada activa para pausar.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar solicitud/ })).not.toBeInTheDocument();
  });

  it("shows a loading state until Today is known, then the form", async () => {
    const view = renderInProviders(<RequestPauseSheet open onClose={() => {}} />, {
      myCircle: pairCircleFixture(),
    });
    expect(view.container.ownerDocument.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(await screen.findByRole("button", { name: "Todos" })).toBeInTheDocument();
  });
});
