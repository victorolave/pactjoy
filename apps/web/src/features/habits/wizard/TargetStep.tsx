import type { Dispatch } from "react";
import { fromScaled, toScaled } from "../../../shared/decimal.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import { FrequencyPicker } from "./FrequencyPicker.tsx";
import { type Frequency, UNIT_STEPS } from "./measure-defaults.ts";
import { ScoringPreview } from "./ScoringPreview.tsx";
import styles from "./Wizard.module.css";
import { unitSuffix } from "./wizard-copy.ts";
import { type WizardAction, type WizardDraft, wizardFields } from "./wizard-model.ts";

function Threshold({
  label,
  value,
  suffix,
  hint,
  step,
  min,
  max = 99999999900n,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly suffix: string;
  readonly hint: string;
  readonly step: bigint;
  readonly min: bigint;
  readonly max?: bigint;
  readonly onChange: (value: string) => void;
}) {
  const scaled = toScaled(value) ?? 0n;
  return (
    <div className={styles.field}>
      <span>{label}</span>
      <div className={styles.row}>
        <IconButton
          icon="minus"
          label={`Restar ${label}`}
          variant="outline"
          disabled={scaled <= min}
          onClick={() => onChange(fromScaled(scaled - step < min ? min : scaled - step))}
        />
        <output aria-label={label}>
          {value} {suffix}
        </output>
        <IconButton
          icon="plus"
          label={`Sumar ${label}`}
          variant="outline"
          disabled={scaled >= max}
          onClick={() => onChange(fromScaled(scaled + step > max ? max : scaled + step))}
        />
      </div>
      <span className={styles.hint}>{hint}</span>
    </div>
  );
}

export function TargetStep({
  draft,
  dispatch,
}: {
  readonly draft: WizardDraft;
  readonly dispatch: Dispatch<WizardAction>;
}) {
  const measure = draft.measure;
  const patch = (next: typeof measure) => dispatch({ type: "patch", patch: { measure: next } });
  const frequency =
    measure.unit === "done"
      ? measure.frequency
      : measure.schedule.period === "perSession"
        ? measure.schedule.frequency
        : null;
  const setFrequency = (next: Frequency) => {
    if (measure.unit === "done") patch({ unit: "done", frequency: next });
    else patch({ ...measure, schedule: { period: "perSession", frequency: next } });
  };
  return (
    <div className={styles.stack}>
      {wizardFields(measure).frequency && frequency !== null && (
        <FrequencyPicker value={frequency} onChange={setFrequency} />
      )}
      {measure.unit !== "done" && (
        <div className={styles.fields}>
          {measure.direction === "reach" ? (
            <>
              <Threshold
                label="Mínimo"
                value={measure.minimum}
                suffix={unitSuffix(measure)}
                hint="para un día difícil"
                step={UNIT_STEPS[measure.unit]}
                min={UNIT_STEPS[measure.unit]}
                max={toScaled(measure.ideal) ?? 0n}
                onChange={(minimum) => patch({ ...measure, minimum })}
              />
              <Threshold
                label="Ideal"
                value={measure.ideal}
                suffix={unitSuffix(measure)}
                hint="da el 100 %"
                step={UNIT_STEPS[measure.unit]}
                min={toScaled(measure.minimum) ?? 1n}
                onChange={(ideal) => patch({ ...measure, ideal })}
              />
            </>
          ) : (
            <>
              <Threshold
                label="Ideal"
                value={measure.ideal}
                suffix={unitSuffix(measure)}
                hint="hasta aquí, 100 %"
                step={UNIT_STEPS[measure.unit]}
                min={0n}
                max={toScaled(measure.tolerance) ?? 0n}
                onChange={(ideal) => patch({ ...measure, ideal })}
              />
              <Threshold
                label="Tolerancia"
                value={measure.tolerance}
                suffix={unitSuffix(measure)}
                hint="en un día difícil"
                step={UNIT_STEPS[measure.unit]}
                min={toScaled(measure.ideal) ?? 0n}
                onChange={(tolerance) => patch({ ...measure, tolerance })}
              />
            </>
          )}
        </div>
      )}
      <ScoringPreview measure={measure} />
    </div>
  );
}
