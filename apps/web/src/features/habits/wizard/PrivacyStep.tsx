import type { Dispatch } from "react";
import { Card } from "../../../ui/Card.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { HABIT_ICON_LABELS, HABIT_ICONS, iconFor } from "../icon-catalog.ts";
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

export function WizardSummary({
  draft,
  saved = false,
}: {
  readonly draft: WizardDraft;
  readonly saved?: boolean;
}) {
  const icon = HABIT_ICONS.find((item) => item.key === draft.icon);
  return (
    <Card as="section" aria-label="Resumen" flush>
      <div className={styles.summary}>
        {!saved && <span className={styles.summaryLabel}>Resumen</span>}
        <div className={styles.summaryHeading}>
          {saved && (
            <Icon
              name={iconFor(draft.icon)}
              {...(icon ? { label: HABIT_ICON_LABELS[icon.key] } : {})}
            />
          )}
          <h2 className={styles.summaryTitle}>{draft.name}</h2>
        </div>
        <p className={styles.summaryMeasure}>{wizardSummary(draft)}</p>
        {!saved && <p className={styles.hint}>Los puntos se calculan cuando repartas los pesos.</p>}
      </div>
    </Card>
  );
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
      <WizardSummary draft={draft} />
    </div>
  );
}
