import type { TodayRow } from "@pactjoy/app";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  endedTodayFixture,
  type WeekRow,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const running = (): DayRow =>
  dayRowFixture({
    commitmentId: "commitment-3" as DayRow["commitmentId"],
    habitName: "Correr",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "decimal",
      target: { direction: "reach", minimum: "3", ideal: "5" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 4] } },
    },
  });

const english = (): WeekRow =>
  weekRowFixture({
    commitmentId: "commitment-4" as WeekRow["commitmentId"],
    habitName: "Inglés",
    measure: {
      unit: "minutes",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "60", ideal: "150" },
      schedule: { period: "weeklyTotal" },
    },
    progress: {
      value: "90",
      target: { direction: "reach", minimum: "60", ideal: "150" },
      sessionsDone: 0,
      sessionsTarget: 1,
      percent: 40,
    },
  });

const open = (rows: TodayRow[], id: string) =>
  renderApp({ path: `/?entry=${id}`, today: activeTodayFixture({ rows }) });

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const dialogFor = (name: string) => screen.findByRole("dialog", { name });

describe("submitting a quantity (EN-R3)", () => {
  it("sends the quantity as a decimal string with the note, then confirms and closes at 1200 ms (EN-S7)", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "10 min" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Nota (opcional)" }), "x");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 10 min" }));

    expect(await screen.findByText("Registro guardado.")).toBeInTheDocument();
    expect(screen.getByText("Leer · 10 min")).toBeInTheDocument();
    expect(deps.api.recorded).toEqual([
      {
        seasonId: "season-1",
        commitmentId: "commitment-2",
        forDate: "2026-10-02",
        value: { kind: "quantity", value: "10" },
        note: "x",
        clientRequestId: "id-1",
      },
    ]);
    expect(screen.getByRole("dialog", { name: "Leer" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1200));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("sends no note when none was written", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]).toMatchObject({
      value: { kind: "quantity", value: "20" },
      note: null,
    });
  });

  it("closes right away from the confirmation's button", async () => {
    open([weekRowFixture()], "commitment-2");
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    await userEvent.click(await screen.findByRole("button", { name: "Seguir con mi día" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("records 0, which a reach with a quantity allows, and blocks an unreadable value", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    const dialog = await dialogFor("Leer");
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    await userEvent.clear(input);
    await userEvent.type(input, "abc");
    expect(within(dialog).getByRole("button", { name: "Registrar" })).toBeDisabled();
    expect(deps.api.calls.recordEntry).toBe(0);
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 0 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "quantity", value: "0" });
  });

  it("records 0 on a weekly total too", async () => {
    const { deps } = open([english()], "commitment-4");
    const dialog = await dialogFor("Inglés");
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 0 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "quantity", value: "0" });
  });

  it("keeps decimals exact on the wire", async () => {
    const { deps } = open([running()], "commitment-3");
    const dialog = await dialogFor("Correr");
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    await userEvent.clear(input);
    await userEvent.type(input, "4,25");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 4,25 km" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "quantity", value: "4.25" });
  });

  it("sends one request on a double tap and disables the button while saving", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    const release = deps.api.hold("recordEntry");
    const dialog = await dialogFor("Leer");
    const submit = within(dialog).getByRole("button", { name: "Registrar 20 min" });
    await userEvent.dblClick(submit);
    expect(submit).toBeDisabled();
    expect(deps.api.calls.recordEntry).toBe(1);
    release();
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded).toHaveLength(1);
  });
});

describe("the day a sheet entry lands on (C-W4)", () => {
  it("sends the day on display, and the last season day after the season ended", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]?.forDate).toBe("2026-10-02");
  });

  it("uses the season's last day in the grace period", async () => {
    const { deps } = renderApp({
      path: "/?entry=commitment-2",
      today: endedTodayFixture({
        rows: [
          weekRowFixture({ opportunity: { state: "open", graceUntil: "2026-10-26" as never } }),
        ],
      }),
    });
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]?.forDate).toBe("2026-10-25");
  });
});

describe("a weekly total adds a new entry each time (EN-R4, EN-S10)", () => {
  it("posts the amount as its own entry, and a second registration is another entry", async () => {
    const { deps } = open([english()], "commitment-4");
    let dialog = await dialogFor("Inglés");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 30 min" }));
    await screen.findByText("Registro guardado.");
    await userEvent.click(screen.getByRole("button", { name: "Seguir con mi día" }));
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Inglés" }));
    dialog = await dialogFor("Inglés");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 30 min" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(2));
    expect(deps.api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["id-1", "id-2"]);
    expect(deps.api.recorded.every((cmd) => cmd.value.kind === "quantity")).toBe(true);
  });
});

describe("failures (EN-R2, EN-R8)", () => {
  it("explains a closed window inside the sheet, keeps it open and refetches Today (EN-S14)", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    deps.api.failNext("recordEntry", new ApiError("WindowClosed", 409, "req-1"));
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Ya no se puede registrar este día.",
    );
    expect(screen.getByRole("dialog", { name: "Leer" })).toBeInTheDocument();
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("keeps the sheet open with the quantity error for InvalidQuantity (EN-S15)", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    deps.api.failNext("recordEntry", new ApiError("InvalidQuantity", 422, "req-2"));
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("La cantidad no es válida.");
    expect(screen.getByRole("dialog", { name: "Leer" })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("20");
  });

  it("puts a note error on the note field", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    deps.api.failNext("recordEntry", new ApiError("NoteTooLong", 422, "req-3"));
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Nota (opcional)" }), "larga");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    const note = await within(dialog).findByRole("textbox", { name: "Nota (opcional)" });
    await waitFor(() => expect(note).toHaveAccessibleDescription("La nota es demasiado larga."));
    expect(note).toHaveValue("larga");
  });

  it("retrying the same entry reuses its request id, and a changed entry gets a new one", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    deps.api.failNext("recordEntry", new ApiError("NetworkError", 0, null));
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No pudimos guardar el registro.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recordAttempts.map((cmd) => cmd.clientRequestId)).toEqual(["id-1", "id-1"]);
  });

  it("uses a new request id when the value changed after a failure", async () => {
    const { deps } = open([weekRowFixture()], "commitment-2");
    deps.api.failNext("recordEntry", new ApiError("NetworkError", 0, null));
    const dialog = await dialogFor("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    await within(dialog).findByRole("alert");
    await userEvent.click(within(dialog).getByRole("button", { name: "30 min" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 30 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recordAttempts.map((cmd) => cmd.clientRequestId)).toEqual(["id-1", "id-2"]);
  });

  it("records Hoy no salió from the sheet of a day row (EN-R2)", async () => {
    const { deps } = open([running()], "commitment-3");
    const dialog = await dialogFor("Correr");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hoy no salió" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]).toMatchObject({ value: { kind: "missed" }, note: null });
  });

  it("does not offer Hoy no salió on a week row", async () => {
    open([weekRowFixture()], "commitment-2");
    const dialog = await dialogFor("Leer");
    expect(within(dialog).queryByRole("button", { name: "Hoy no salió" })).not.toBeInTheDocument();
  });
});
