import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { renderApp } from "../../../testing/render.tsx";
import { wizardHabit, wizardSeason } from "./wizard-fixtures.ts";

function setup(path = `/season/${wizardSeason.id}/habits/new`) {
  const app = renderApp({ path });
  app.deps.api.setPactResponse("getSeason", wizardSeason);
  app.deps.api.setPactResponse("listHabits", [wizardHabit]);
  app.deps.api.setPactResponse("createHabit", wizardHabit);
  app.deps.api.setPactResponse("updateHabit", { ...wizardHabit, name: "Lectura", version: 4 });
  app.deps.api.setPactResponse("addCommitment", { ...wizardSeason, version: 2 });
  app.deps.api.setPactResponse("editCommitment", { ...wizardSeason, version: 2 });
  app.deps.api.setPactResponse("previewScoring", { rows: [{ value: "1", progressPercent: "77" }] });
  return app;
}

async function next() {
  await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
}
async function ready() {
  return screen.findByRole("textbox", { name: "Nombre" });
}
async function lastStep() {
  await ready();
  await next();
  await next();
  await next();
}

describe("habit wizard routes (screens 9/9c)", () => {
  it("keeps integer minimum steppers positive and disables empty weekday selections", async () => {
    setup();
    await ready();
    await next();
    await userEvent.click(screen.getByRole("radio", { name: "Páginas" }));
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Restar Mínimo" }));
    expect(screen.getByLabelText("Mínimo")).toHaveTextContent("5 páginas");
    expect(screen.getByRole("button", { name: "Restar Mínimo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Días concretos" }));
    for (const name of ["Martes", "Jueves", "Sábado"])
      await userEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Domingo" }));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("steps a prefilled fractional threshold exactly without binary rounding", async () => {
    setup(`/season/${wizardSeason.id}/commitments/commitment-read/edit`);
    await ready();
    await next();
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Sumar Ideal" }));
    expect(screen.getByLabelText("Ideal")).toHaveTextContent("1.75 km");
    await userEvent.click(screen.getByRole("button", { name: "Restar Ideal" }));
    expect(screen.getByLabelText("Ideal")).toHaveTextContent("0.75 km");
  });

  it("does not substitute a new habit when a requested habitId is not owned", async () => {
    setup(`/season/${wizardSeason.id}/habits/new?habitId=someone-elses-habit`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    expect(screen.queryByRole("textbox", { name: "Nombre" })).not.toBeInTheDocument();
  });

  it("prefills category defaults and closed-catalog icons; done hides direction and period", async () => {
    setup();
    expect(await ready()).toHaveValue("Leer");
    const icons = screen.getByRole("radiogroup", { name: "Ícono" });
    expect(icons).toBeVisible();
    expect(within(icons).getAllByRole("radio")).toHaveLength(20);
    await userEvent.click(screen.getByRole("radio", { name: "Movimiento" }));
    expect(screen.getByRole("textbox", { name: "Nombre" })).toHaveValue("Movimiento");
    expect(screen.getByRole("radio", { name: "footprints" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Creatividad" }));
    await next();
    expect(screen.getByRole("heading", { name: "¿Cómo lo mides?" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Hecho / no hecho" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByRole("radiogroup", { name: "2 · Dirección" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "3 · Periodo" })).not.toBeInTheDocument();
    await next();
    expect(screen.getByRole("radiogroup", { name: "Tipo de frecuencia" })).toBeVisible();
    expect(screen.queryByLabelText("Mínimo")).not.toBeInTheDocument();
    expect(await screen.findByText("77 %")).toBeVisible();
  });

  it("limit renames minimum to tolerance and hides frequency; weekly uses weeklyTotal", async () => {
    setup();
    await ready();
    await next();
    await userEvent.click(screen.getByRole("radio", { name: /No exceder/ }));
    await next();
    expect(screen.getByRole("heading", { name: "¿Cuánto como máximo?" })).toBeVisible();
    expect(screen.getByText("Tolerancia")).toBeVisible();
    expect(screen.queryByText("Mínimo")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", { name: "Tipo de frecuencia" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("por día")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await userEvent.click(screen.getByRole("radio", { name: /Semanal acumulado/ }));
    await next();
    expect(screen.getByText("por semana")).toBeVisible();
  });

  it("supports keyboard radio selection, custom units, exact decimal steppers and specific weekdays", async () => {
    setup();
    await ready();
    await next();
    await userEvent.click(screen.getByRole("radio", { name: "Personalizada" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Unidad personalizada" }), "vueltas");
    const direction = screen.getByRole("radio", { name: /Alcanzar/ });
    direction.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /No exceder/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(direction).toHaveAttribute("aria-checked", "true");
    await next();
    await userEvent.click(screen.getByRole("radio", { name: "Días concretos" }));
    expect(screen.getByRole("button", { name: "Lunes" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Lunes" }));
    expect(screen.getByRole("button", { name: "Lunes" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Sumar Ideal" }));
    expect(screen.getByLabelText("Ideal")).toHaveTextContent("4 vueltas");
    await next();
    expect(screen.getByText(/Los puntos se calculan cuando repartas los pesos/)).toBeVisible();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recordatorio/)).not.toBeInTheDocument();
  });

  it("creates a habit then commitment, disables duplicate saves and renders done", async () => {
    const { deps, location } = setup();
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "coffee" }));
    expect(screen.getByRole("radio", { name: "coffee" })).toHaveAttribute("aria-checked", "true");
    await lastStep();
    await userEvent.click(screen.getByRole("radio", { name: /Privado/ }));
    const release = deps.api.hold("createHabit");
    await userEvent.click(screen.getByRole("button", { name: "Guardar hábito" }));
    expect(screen.getByRole("button", { name: "Guardar hábito" })).toBeDisabled();
    expect(deps.api.calls.addCommitment).toBe(0);
    await act(async () => release());
    expect(await screen.findByRole("heading", { name: "Hábito guardado" })).toBeVisible();
    expect(
      deps.api.pactCommands
        .filter((c) => ["createHabit", "addCommitment"].includes(c.method))
        .map((c) => c.method),
    ).toEqual(["createHabit", "addCommitment"]);
    expect(deps.api.pactCommands.find((c) => c.method === "addCommitment")?.args[1]).toMatchObject({
      weightPercent: 5,
      privacy: "private",
    });
    expect(deps.api.pactCommands.find((c) => c.method === "createHabit")?.args[0]).toMatchObject({
      icon: "coffee",
    });
    await userEvent.click(screen.getByRole("button", { name: "Crear otro hábito" }));
    expect(await ready()).toHaveValue("Leer");
    expect(location()).toBe(`/season/${wizardSeason.id}/habits/new`);
  });

  it("accepts screen 10's habitId and reuses it instead of creating another habit", async () => {
    const { deps } = setup(`/season/${wizardSeason.id}/habits/new?habitId=${wizardHabit.id}`);
    expect(await ready()).toHaveValue(wizardHabit.name);
    expect(
      screen.getByRole("textbox", { name: "¿Por qué quieres este hábito? (opcional)" }),
    ).toHaveValue("Aprender");
    await next();
    await next();
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Guardar hábito" }));
    expect(await screen.findByRole("heading", { name: "Hábito guardado" })).toBeVisible();
    expect(deps.api.calls.createHabit).toBe(0);
    expect(deps.api.calls.updateHabit).toBe(0);
    expect(deps.api.pactCommands.find((c) => c.method === "addCommitment")?.args[1]).toMatchObject({
      habitId: wizardHabit.id,
      weightPercent: 5,
    });
  });

  it("prefills edit measure, days and privacy; skips unchanged habit PATCH and preserves weight", async () => {
    const { deps, location } = setup(`/season/${wizardSeason.id}/commitments/commitment-read/edit`);
    await ready();
    await next();
    expect(screen.getByRole("radio", { name: "Km" })).toHaveAttribute("aria-checked", "true");
    await next();
    expect(screen.getByLabelText("Mínimo")).toHaveTextContent("0.15 km");
    expect(screen.getByLabelText("Ideal")).toHaveTextContent("0.75 km");
    expect(screen.getByRole("button", { name: "Lunes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Viernes" })).toHaveAttribute("aria-pressed", "true");
    await next();
    expect(screen.getByRole("radio", { name: /Privado/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Guardar hábito" }));
    expect(await screen.findByRole("heading", { name: "Hábito guardado" })).toBeVisible();
    expect(deps.api.calls.updateHabit).toBe(0);
    expect(deps.api.pactCommands.find((c) => c.method === "editCommitment")?.args[2]).toMatchObject(
      { weightPercent: 25 },
    );
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    expect(location()).toBe(`/season/${wizardSeason.id}/habits`);
  });

  it("clears optional metadata with null and retries a failed save without losing the draft", async () => {
    const { deps } = setup(`/season/${wizardSeason.id}/commitments/commitment-read/edit`);
    await ready();
    await userEvent.clear(
      screen.getByRole("textbox", { name: "¿Por qué quieres este hábito? (opcional)" }),
    );
    deps.api.setPactResponse("updateHabit", { ...wizardHabit, why: null, version: 4 });
    deps.api.failNext("editCommitment", new ApiError("ConcurrencyConflict", 409, null));
    await next();
    await next();
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Guardar hábito" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    expect(screen.getByRole("heading", { name: "¿Quién lo ve?" })).toBeVisible();
    await userEvent.click(
      within(screen.getByRole("alert")).getByRole("button", { name: "Reintentar" }),
    );
    expect(await screen.findByRole("heading", { name: "Hábito guardado" })).toBeVisible();
    expect(deps.api.calls.updateHabit).toBe(1);
    expect(deps.api.pactCommands.find((c) => c.method === "updateHabit")?.args[1]).toEqual({
      expectedVersion: 3,
      why: null,
    });
  });

  it("shows loading and retry on read failure instead of rendering an empty editor", async () => {
    const { deps } = setup();
    const release = deps.api.hold("getSeason");
    deps.api.failNext("getSeason", new ApiError("NetworkError", 0, null));
    expect(screen.queryByRole("textbox", { name: "Nombre" })).not.toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await ready()).toHaveValue("Leer");
  });

  it("does not expose or edit a commitment owned by another member", async () => {
    const { deps } = setup(`/season/${wizardSeason.id}/commitments/commitment-read/edit`);
    deps.api.setPactResponse("getSeason", {
      ...wizardSeason,
      commitments: wizardSeason.commitments.map((c) => ({ ...c, memberId: "member-andrea" })),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    expect(screen.queryByRole("textbox", { name: "Nombre" })).not.toBeInTheDocument();
    expect(deps.api.calls.editCommitment).toBe(0);
  });
});
