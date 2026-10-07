import type { Dispatch } from "react";
import { Card } from "../../../ui/Card.tsx";
import { Choices } from "./Choices.tsx";
import { WEEKDAYS } from "./FrequencyPicker.tsx";
import styles from "./Wizard.module.css";
import { unitSuffix } from "./wizard-copy.ts";
import type { WizardAction, WizardDraft } from "./wizard-model.ts";

export function wizardSummary(draft: WizardDraft): string {
  const measure = draft.measure;
  const frequency =
    measure.unit === "done"
      ? measure.frequency
      : measure.schedule.period === "perSession"
        ? measure.schedule.frequency
        : null;
  const schedule =
    frequency === null
      ? "acumulado semanal"
      : measure.unit !== "done" && measure.direction === "limit"
        ? "todos los días"
        : frequency.kind === "timesPerWeek"
          ? `${frequency.times} ${frequency.times === 1 ? "vez" : "veces"} por semana`
          : frequency.weekdays.map((day) => WEEKDAYS[day].slice(0, 3)).join(" · ");
  const target =
    measure.unit === "done"
      ? "hecho / no hecho"
      : measure.direction === "reach"
        ? `mín. ${measure.minimum}, ideal ${measure.ideal} ${unitSuffix(measure)}`
        : `ideal ${measure.ideal}, tolerancia ${measure.tolerance} ${unitSuffix(measure)}`;
  return `${schedule} · ${target} · ${draft.privacy === "visible" ? "visible" : "privado"}`;
}

export function PrivacyStep({
  draft,
  dispatch,
}: {
  readonly draft: WizardDraft;
  readonly dispatch: Dispatch<WizardAction>;
}) {
  return (
    <div className={styles.stack}>
      <Choices
        label="¿Quién lo ve?"
        value={draft.privacy}
        options={[
          { value: "visible", label: "Visible", hint: "El círculo ve el nombre y tu avance." },
          {
            value: "private",
            label: "Privado",
            hint: "El círculo solo ve “Objetivo privado”, su peso y sus puntos.",
          },
        ]}
        onChange={(privacy) => dispatch({ type: "patch", patch: { privacy } })}
      />
      <Card>
        <div className={styles.stack}>
          <span className={styles.hint}>Resumen</span>
          <strong>{draft.name}</strong>
          <p>{wizardSummary(draft)}</p>
          <p className={styles.hint}>Los puntos se calculan cuando repartas los pesos.</p>
        </div>
      </Card>
    </div>
  );
}
