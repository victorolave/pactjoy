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
  it("groups the frequency stepper and target helpers into their cards", async () => {
    setup();
    await ready();
    await next();
    await next();
    const frequency = within(screen.getByRole("group", { name: "Frecuencia" }));
    expect(frequency.getByRole("status")).toHaveTextContent("5 veces por semana");
    expect(frequency.getByRole("button", { name: "Sumar veces por semana" })).toBeVisible();
    const minimum = within(screen.getByRole("group", { name: "Mínimo" }));
    expect(minimum.getByRole("status")).toHaveTextContent("10 min");
    expect(minimum.getByText("para un día difícil")).toBeVisible();
    const ideal = within(screen.getByRole("group", { name: "Ideal" }));
    expect(ideal.getByRole("status")).toHaveTextContent("30 min");
    expect(ideal.getByText("da el 100 %")).toBeVisible();
  });

  it("renders a titled summary and reuses it with the chosen icon after saving", async () => {
    setup();
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "Café" }));
    await lastStep();
    expect(screen.getByRole("main").querySelectorAll("[data-current]")).toHaveLength(4);
    const summary = within(screen.getByRole("region", { name: "Resumen" }));
    expect(summary.getByRole("heading", { level: 2, name: "Leer" })).toBeVisible();
    const measure = "5 veces por semana · mín. 10, ideal 30 min · visible";
    expect(summary.getByText(measure)).toBeVisible();
    expect(summary.getByText("Los puntos se calculan cuando repartas los pesos.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Guardar hábito" }));
    expect(await screen.findByRole("heading", { name: "Hábito guardado" })).toHaveFocus();
    expect(screen.getByRole("main").querySelectorAll("[data-current]")).toHaveLength(0);
    const saved = within(screen.getByRole("region", { name: "Resumen" }));
    expect(saved.getByRole("heading", { level: 2, name: "Leer" })).toBeVisible();
    expect(saved.getByText(measure)).toBeVisible();
    expect(saved.getByRole("img", { name: "Café" })).toBeVisible();
    expect(screen.queryByText(/Los puntos se calculan/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear otro hábito" })).toBeEnabled();
  });

  it("exposes all 20 icon choices with owner-approved Spanish accessible names", async () => {
    setup();
    await ready();
    const icons = within(screen.getByRole("radiogroup", { name: "Ícono" })).getAllByRole("radio");
    const names = [
      "Libro",
      "Cerebro",
      "Café",
      "Pesas",
      "Flor",
      "Pasos",
      "Arte",
      "Sol",
      "Calendario",
      "Hecho",
      "Repetición",
      "Historial",
      "Lápiz",
      "Más",
      "Grupo",
      "Acuerdo",
      "Persona",
      "Ajustes",
      "Completado",
      "Luna",
    ];
    expect(icons).toHaveLength(20);
    icons.forEach((icon, index) => {
      expect(icon).toHaveAccessibleName(names[index]);
    });
  });
  it("focuses the heading and announces progress on forward and backward step changes", async () => {
    setup();
    await ready();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("data-step-focus", "true");
    await userEvent.keyboard("{Tab}");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveAttribute("data-step-focus");
    expect(screen.getByText("Paso 1 de 4")).toHaveAttribute("role", "status");
    const name = screen.getByRole("textbox", { name: "Nombre" });
    await userEvent.type(name, "!");
    expect(name).toHaveFocus();
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect(cancel.querySelector("svg")).toHaveClass("lucide-x");
    await next();
    expect(screen.getByRole("heading", { name: "¿Cómo lo mides?" })).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("data-step-focus", "true");
    expect(screen.getByText("Paso 2 de 4")).toHaveAttribute("role", "status");
    const reach = screen.getByRole("radio", { name: "Alcanzar" });
    expect(reach).not.toHaveAttribute("aria-label");
    expect(reach).toHaveAccessibleDescription("Más es mejor, hasta tu ideal.");
    expect(screen.getByRole("radio", { name: "No exceder" })).toHaveAccessibleDescription(
      "Menos es mejor. Registras cada día, aunque sea 0.",
    );
    await next();
    expect(screen.getByRole("heading", { name: "¿Cuánto y cada cuánto?" })).toHaveFocus();
    expect(screen.getByText("Paso 3 de 4")).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Restar veces por semana" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sumar veces por semana" })).toBeVisible();
    expect(screen.getByRole("status", { name: "Frecuencia: 5 veces por semana" })).toBeVisible();
    await next();
    expect(screen.getByRole("heading", { name: "¿Quién lo ve?" })).toHaveFocus();
    expect(screen.getByText("Paso 4 de 4")).toHaveAttribute("role", "status");
    await userEvent.click(screen.getByRole("button", { name: "Atrás" }));
    expect(screen.getByRole("heading", { name: "¿Cuánto y cada cuánto?" })).toHaveFocus();
  });

  it("limits custom labels to the backend's 20 characters", async () => {
    setup();
    await ready();
    await next();
    await userEvent.click(screen.getByRole("radio", { name: "Personalizada" }));
    const label = screen.getByRole("textbox", { name: "Unidad personalizada" });
    expect(label).toHaveAttribute("maxlength", "20");
    await userEvent.type(label, "123456789012345678901");
    expect(label).toHaveValue("12345678901234567890");
  });

  it.each(["loading", "error"])(
    "cancels from %s directly to the season habit list",
    async (state) => {
      const { deps, location } = setup();
      const release = deps.api.hold("getSeason");
      if (state === "error") {
        deps.api.failNext("getSeason", new ApiError("NetworkError", 0, null));
        await act(async () => release());
        await screen.findByRole("alert");
      }
      await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(location()).toBe(`/season/${wizardSeason.id}/habits`);
      if (state === "loading") await act(async () => release());
    },
  );

  it("keeps integer minimum steppers positive and disables empty weekday selections", async () => {
    setup();
    await ready();
    await next();
    await userEvent.click(screen.getByRole("radio", { name: "Páginas" }));
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Restar Mínimo" }));
    expect(screen.getByRole("status", { name: "Mínimo: 5 páginas" })).toHaveTextContent(
      "5 páginas",
    );
    expect(screen.getByRole("button", { name: "Restar Mínimo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Días concretos" }));
    expect(screen.getByRole("group", { name: "Días de la semana" })).toBeVisible();
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
    expect(screen.getByRole("status", { name: "Ideal: 1.75 km" })).toHaveTextContent("1.75 km");
    await userEvent.click(screen.getByRole("button", { name: "Restar Ideal" }));
    expect(screen.getByRole("status", { name: "Ideal: 0.75 km" })).toHaveTextContent("0.75 km");
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
    expect(screen.getByRole("radio", { name: "Pasos" })).toHaveAttribute("aria-checked", "true");
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
    expect(
      screen.getByText("Frecuencia: todos los días (en “no exceder” cada día es una oportunidad)."),
    ).toBeVisible();
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
    expect(screen.getByRole("status", { name: "Ideal: 4 vueltas" })).toHaveTextContent("4 vueltas");
    await next();
    expect(screen.getByText(/Los puntos se calculan cuando repartas los pesos/)).toBeVisible();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recordatorio/)).not.toBeInTheDocument();
  });

  it("creates a habit then commitment, disables duplicate saves and renders done", async () => {
    const { deps, location } = setup();
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "Café" }));
    expect(screen.getByRole("radio", { name: "Café" })).toHaveAttribute("aria-checked", "true");
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

  it("prefills uncategorized habits as custom/done without changing null metadata", async () => {
    const { deps } = setup(`/season/${wizardSeason.id}/habits/new?habitId=${wizardHabit.id}`);
    deps.api.setPactResponse("listHabits", [{ ...wizardHabit, category: null }]);
    await ready();
    expect(screen.getByRole("radio", { name: "Crear el mío" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await next();
    expect(screen.getByRole("radio", { name: "Hecho / no hecho" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await next();
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Guardar hábito" }));
    expect(await screen.findByRole("heading", { name: "Hábito guardado" })).toHaveFocus();
    expect(deps.api.calls.updateHabit).toBe(0);
    expect(deps.api.pactCommands.find((c) => c.method === "addCommitment")?.args[1]).toMatchObject({
      measure: { unit: "done" },
    });
  });

  it("prefills edit measure, days and privacy; skips unchanged habit PATCH and preserves weight", async () => {
    const { deps, location } = setup(`/season/${wizardSeason.id}/commitments/commitment-read/edit`);
    await ready();
    await next();
    expect(screen.getByRole("radio", { name: "Km" })).toHaveAttribute("aria-checked", "true");
    await next();
    expect(screen.getByRole("status", { name: "Mínimo: 0.15 km" })).toHaveTextContent("0.15 km");
    expect(screen.getByRole("status", { name: "Ideal: 0.75 km" })).toHaveTextContent("0.75 km");
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
