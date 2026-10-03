import type { TodayView } from "@pactjoy/app";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  endedTodayFixture,
  entryFixture,
  noCircleTodayFixture,
  noSeasonTodayFixture,
  pactOpenTodayFixture,
  type WeekRow,
  weekRowFixture,
} from "../testing/fixtures/today.ts";

/** How a scenario behaves around the data: it answers, never answers, fails, or is read offline. */
export type ScenarioMode = "data" | "loading" | "error" | "offline";

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly mode: ScenarioMode;
  /** What `GET /me/today` answers, built fresh each time. */
  today(): TodayView;
}

type Active = Extract<TodayView, { state: "active" | "ended" }>;
type DateOf<T> = T extends { today: infer D } ? D : never;
const date = (value: string) => value as DateOf<Active>;

const id = <T>(value: string) => value as T;

// Day-bound rows: perSession + specificDays only, as the server produces them.
const meditar = (overrides: Partial<DayRow> = {}): DayRow =>
  dayRowFixture({
    commitmentId: id("c-meditar"),
    habitName: "Meditar",
    ...overrides,
  });

const correr = (overrides: Partial<DayRow> = {}): DayRow =>
  dayRowFixture({
    commitmentId: id("c-correr"),
    habitName: "Correr",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "decimal",
      target: { direction: "reach", minimum: "3", ideal: "5" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [1, 4] } },
    },
    points: { perOpportunity: "12.5", earned: null, limitPercents: null },
    ...overrides,
  });

const cafe = (overrides: Partial<DayRow> = {}): DayRow =>
  dayRowFixture({
    commitmentId: id("c-cafe"),
    habitName: "Máximo 2 cafés al día",
    measure: {
      unit: "times",
      customLabel: "cafés",
      precision: "integer",
      target: { direction: "limit", ideal: "2", tolerance: "4" },
      schedule: {
        period: "perSession",
        frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
    },
    points: {
      perOpportunity: "3.57",
      earned: null,
      limitPercents: [100, 100, 100, 75, 50, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    ...overrides,
  });

// Week-bound rows: they count at week close plus grace, so they never show earned points.
const leer = (overrides: Partial<WeekRow> = {}): WeekRow =>
  weekRowFixture({
    commitmentId: id("c-leer"),
    habitName: "Leer",
    points: { perOpportunity: "6.25", earned: null, limitPercents: null },
    ...overrides,
  });

const ingles = (overrides: Partial<WeekRow> = {}): WeekRow =>
  weekRowFixture({
    commitmentId: id("c-ingles"),
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
      percent: 60,
    },
    points: { perOpportunity: "31.25", earned: null, limitPercents: null },
    ...overrides,
  });

const caminar = (overrides: Partial<WeekRow> = {}): WeekRow =>
  weekRowFixture({
    commitmentId: id("c-caminar"),
    habitName: "Caminar",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "decimal",
      target: { direction: "reach", minimum: "10", ideal: "25" },
      schedule: { period: "weeklyTotal" },
    },
    progress: {
      value: "12.5",
      target: { direction: "reach", minimum: "10", ideal: "25" },
      sessionsDone: 1,
      sessionsTarget: 1,
      percent: 50,
    },
    points: { perOpportunity: "20", earned: null, limitPercents: null },
    ...overrides,
  });

const logged = (row: DayRow, entries: DayRow["entries"], earned: number): DayRow => ({
  ...row,
  opportunity: { state: "logged", graceUntil: date("2026-10-03") },
  entries,
  points: { ...row.points, earned },
});

const withSummary = (view: Active, pointsToday: number): Active => ({
  ...view,
  summary: { ...view.summary, pointsToday },
});

const gym = (): DayRow =>
  meditar({
    commitmentId: id("c-gym"),
    habitName: "Gym",
    opportunity: { state: "paused", graceUntil: null },
  });

const mixed = (): TodayView =>
  activeTodayFixture({
    rows: [
      meditar(),
      correr(),
      cafe(),
      gym(),
      leer({
        progress: {
          value: "40",
          target: { direction: "reach", minimum: "10", ideal: "30" },
          sessionsDone: 2,
          sessionsTarget: 3,
          percent: 67,
        },
      }),
      ingles(),
    ],
  });

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "noCircle",
    title: "Sin círculo",
    description: "El usuario aún no está en un círculo.",
    mode: "data",
    today: noCircleTodayFixture,
  },
  {
    id: "noSeason",
    title: "Sin temporada",
    description: "Hay círculo, pero todavía no hay temporada.",
    mode: "data",
    today: noSeasonTodayFixture,
  },
  {
    id: "pactOpen",
    title: "Pacto abierto",
    description: "Falta que todos aprueben el pacto.",
    mode: "data",
    today: pactOpenTodayFixture,
  },
  {
    id: "notStarted",
    title: "Temporada por empezar",
    description: "El pacto está aprobado; la temporada empieza pronto.",
    mode: "data",
    today: () => ({ ...pactOpenTodayFixture(), state: "notStarted" }) as TodayView,
  },
  {
    id: "mixed",
    title: "Activa, filas mixtas",
    description:
      "Hecho/no hecho, cantidad por día, tope de cafés, una pausa, N veces por semana y un total semanal.",
    mode: "data",
    today: mixed,
  },
  {
    id: "nothingToday",
    title: "Día sin compromisos (15c)",
    description: "Un domingo: nada previsto, solo lo semanal.",
    mode: "data",
    today: () =>
      activeTodayFixture({
        today: date("2026-10-04"),
        rows: [
          meditar({ scheduledToday: false, opportunity: { state: "open", graceUntil: null } }),
          leer({
            progress: {
              value: "150",
              target: { direction: "reach", minimum: "10", ideal: "30" },
              sessionsDone: 3,
              sessionsTarget: 3,
              percent: 100,
            },
          }),
          ingles(),
        ],
      }),
  },
  {
    id: "allDone",
    title: "Todo registrado (15b)",
    description: "Todo lo de hoy cumplido, con cantidad y puntos del día.",
    mode: "data",
    today: () =>
      withSummary(
        activeTodayFixture({
          rows: [
            logged(meditar(), [entryFixture({ kind: "done" })], 8),
            logged(
              correr(),
              [entryFixture({ kind: "quantity", value: "5" }, { entryId: id("e-correr") })],
              13,
            ),
            leer(),
          ],
        }),
        21,
      ),
  },
  {
    id: "allLoggedWithMiss",
    title: "Registrado con «Hoy no salió»",
    description: "Todo registrado, pero un día no salió: no se celebra.",
    mode: "data",
    today: () =>
      withSummary(
        activeTodayFixture({
          rows: [
            logged(meditar(), [entryFixture({ kind: "done" })], 8),
            logged(
              meditar({ commitmentId: id("c-estirar"), habitName: "Estirar" }),
              [entryFixture({ kind: "missed" }, { entryId: id("e-estirar") })],
              0,
            ),
          ],
        }),
        8,
      ),
  },
  {
    id: "endedInGrace",
    title: "Temporada terminada, en gracia",
    description: "Pasó el último día; los registros abiertos se pueden ajustar.",
    mode: "data",
    today: () =>
      endedTodayFixture({
        rows: [
          meditar({
            scheduledToday: true,
            measure: {
              unit: "done",
              schedule: {
                period: "perSession",
                frequency: { kind: "specificDays", weekdays: [6] },
              },
            },
            opportunity: { state: "open", graceUntil: date("2026-10-26") },
          }),
          leer({ opportunity: { state: "closed", graceUntil: date("2026-10-26") } }),
        ],
      }),
  },
  {
    id: "weekRowsOnly",
    title: "Solo filas semanales",
    description: "N veces por semana y totales semanales, sin días concretos.",
    mode: "data",
    today: () => activeTodayFixture({ rows: [leer(), ingles(), caminar()] }),
  },
  {
    id: "loading",
    title: "Cargando (15e)",
    description: "El saludo y la fecha pintan al instante; la respuesta nunca llega.",
    mode: "loading",
    today: mixed,
  },
  {
    id: "error",
    title: "Error de carga (15f)",
    description: "El servidor falla; se puede reintentar.",
    mode: "error",
    today: mixed,
  },
  {
    id: "offline",
    title: "Sin conexión (15g)",
    description: "Se ven los datos guardados con el aviso de que no hay conexión.",
    mode: "offline",
    today: mixed,
  },
];

export const scenarioById = (value: string): Scenario | undefined =>
  SCENARIOS.find((scenario) => scenario.id === value);
