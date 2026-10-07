import type { WizardMeasure } from "./measure-defaults.ts";

export const UNITS: readonly { value: WizardMeasure["unit"]; label: string; suffix: string }[] = [
  { value: "done", label: "Hecho / no hecho", suffix: "" },
  { value: "minutes", label: "Minutos", suffix: "min" },
  { value: "hours", label: "Horas", suffix: "h" },
  { value: "times", label: "Veces", suffix: "veces" },
  { value: "pages", label: "Páginas", suffix: "páginas" },
  { value: "km", label: "Km", suffix: "km" },
  { value: "glasses", label: "Vasos", suffix: "vasos" },
  { value: "custom", label: "Personalizada", suffix: "unidades" },
];

export function unitSuffix(measure: WizardMeasure): string {
  return measure.unit === "custom"
    ? measure.customLabel || "unidades"
    : (UNITS.find((unit) => unit.value === measure.unit)?.suffix ?? "");
}

export function previewNote(measure: WizardMeasure): string {
  if (measure.unit === "done") return "Un toque cada vez que lo haces.";
  return measure.direction === "limit"
    ? "Por encima de la tolerancia, 0 %. Hay que registrar aunque sea 0."
    : "El mínimo cuenta para tu consistencia; solo el ideal da el 100 %. Por encima del ideal no suma más.";
}

export function previewPeriod(measure: WizardMeasure): string {
  if (measure.unit === "done") return "por sesión";
  return measure.schedule.period === "weeklyTotal"
    ? "por semana"
    : measure.direction === "limit"
      ? "por día"
      : "por sesión";
}
