import type { UpdateHabitCommand } from "../../../ports/pactjoy-api.ts";
import type { CommitmentDto, HabitDto } from "../../../ports/wire.ts";
import { fromScaled, toScaled } from "../../../shared/decimal.ts";
import { CATEGORY_ICONS } from "../icon-catalog.ts";
import {
  defaultMeasure,
  type Frequency,
  UNIT_STEPS,
  type WizardMeasure,
} from "./measure-defaults.ts";

export type Category = keyof typeof CATEGORY_ICONS;
export interface WizardDraft {
  readonly step: number;
  readonly name: string;
  readonly why: string;
  readonly category: string | null;
  readonly icon: string | null;
  readonly privacy: "visible" | "private";
  readonly measure: WizardMeasure;
}
const CATEGORY_UNITS: Record<Category, WizardMeasure["unit"]> = {
  Leer: "minutes",
  Movimiento: "km",
  Estudiar: "minutes",
  "Dormir mejor": "hours",
  Creatividad: "done",
  Finanzas: "done",
  "Crear el mío": "done",
};

export function initialWizard(category: Category = "Leer"): WizardDraft {
  return {
    step: 0,
    name: category === "Crear el mío" ? "" : category,
    why: "",
    category,
    icon: CATEGORY_ICONS[category],
    privacy: "visible",
    measure: defaultMeasure(CATEGORY_UNITS[category]),
  };
}

export type WizardAction =
  | { readonly type: "category"; readonly category: Category }
  | { readonly type: "unit"; readonly unit: WizardMeasure["unit"] }
  | { readonly type: "direction"; readonly direction: "reach" | "limit" }
  | { readonly type: "period"; readonly period: "perSession" | "weeklyTotal" }
  | { readonly type: "patch"; readonly patch: Partial<WizardDraft> };

export function wizardReducer(draft: WizardDraft, action: WizardAction): WizardDraft {
  if (action.type === "patch") return { ...draft, ...action.patch };
  if (action.type === "category")
    return {
      ...initialWizard(action.category),
      why: draft.why,
      step: draft.step,
      privacy: draft.privacy,
    };
  const measure = draft.measure;
  const direction = measure.unit === "done" ? "reach" : measure.direction;
  const period = measure.unit === "done" ? "perSession" : measure.schedule.period;
  const frequency: Frequency =
    measure.unit === "done"
      ? measure.frequency
      : measure.schedule.period === "perSession"
        ? measure.schedule.frequency
        : { kind: "timesPerWeek", times: 5 };
  const next = defaultMeasure(
    action.type === "unit" ? action.unit : measure.unit,
    action.type === "direction" ? action.direction : direction,
    action.type === "period" ? action.period : period,
    frequency,
  );
  return {
    ...draft,
    measure:
      next.unit === "custom" && measure.unit === "custom"
        ? {
            ...next,
            customLabel: measure.customLabel ?? null,
            ...(measure.precision ? { precision: measure.precision } : {}),
          }
        : next,
  };
}

export function wizardFields(measure: WizardMeasure) {
  const quantity = measure.unit !== "done";
  return {
    quantity,
    frequency:
      !quantity || (measure.direction === "reach" && measure.schedule.period === "perSession"),
    threshold: quantity && measure.direction === "limit" ? "Tolerancia" : "Mínimo",
  };
}

/** Samples only: the authenticated preview endpoint is the sole scoring authority. */
export function previewValues(measure: WizardMeasure): readonly string[] {
  if (measure.unit === "done") return ["1", "0"];
  const ideal = toScaled(measure.ideal);
  const threshold = toScaled(measure.direction === "reach" ? measure.minimum : measure.tolerance);
  if (ideal === null || threshold === null) return [];
  const midpoint = (ideal + threshold) / 2n;
  const step = UNIT_STEPS[measure.unit];
  const values =
    measure.direction === "reach"
      ? [0n, threshold, midpoint, ideal, ideal + step]
      : [ideal, midpoint, threshold, threshold + step];
  // Wire samples permit nine integer digits and two decimal places.
  return [...new Set(values.filter((value) => value <= 99999999999n).map(fromScaled))];
}

type DetailCommitment = Extract<CommitmentDto, { kind: "detail" }>;

export function prefillWizard(habit: HabitDto, commitment?: DetailCommitment): WizardDraft {
  const category = Object.hasOwn(CATEGORY_ICONS, habit.category ?? "")
    ? Object.keys(CATEGORY_ICONS).find((key): key is Category => key === habit.category)
    : undefined;
  const draft = {
    ...initialWizard(category),
    name: habit.name,
    why: habit.why ?? "",
    category: habit.category,
    icon: habit.icon,
  };
  if (commitment === undefined) return draft;
  const view = commitment.measure;
  const measure: WizardMeasure =
    view.unit === "done"
      ? { unit: "done", frequency: view.schedule.frequency }
      : {
          unit: view.unit,
          customLabel: view.customLabel,
          precision: view.precision,
          schedule: view.schedule,
          ...view.target,
        };
  return { ...draft, measure, privacy: commitment.privacy };
}

/** Metadata edits do not reset approvals; do not issue an unnecessary PATCH. */
export function habitPatch(habit: HabitDto, draft: WizardDraft): UpdateHabitCommand | null {
  const changed: Omit<UpdateHabitCommand, "expectedVersion"> = {
    ...(habit.name !== draft.name.trim() ? { name: draft.name.trim() } : {}),
    ...(habit.why !== (draft.why.trim() || null) ? { why: draft.why.trim() || null } : {}),
    ...(habit.category !== draft.category ? { category: draft.category } : {}),
    ...(habit.icon !== draft.icon ? { icon: draft.icon } : {}),
  };
  return Object.keys(changed).length === 0 ? null : { expectedVersion: habit.version, ...changed };
}
