import type { Dispatch } from "react";
import { TextField } from "../../../ui/TextField.tsx";
import { Choices } from "./Choices.tsx";
import styles from "./Wizard.module.css";
import { UNITS } from "./wizard-copy.ts";
import type { WizardAction, WizardDraft } from "./wizard-model.ts";

export function MeasureStep({
  draft,
  dispatch,
}: {
  readonly draft: WizardDraft;
  readonly dispatch: Dispatch<WizardAction>;
}) {
  const measure = draft.measure;
  return (
    <div className={styles.stack}>
      <strong>1 · Unidad</strong>
      <Choices
        label="1 · Unidad"
        compact
        value={measure.unit}
        options={UNITS}
        onChange={(unit) => dispatch({ type: "unit", unit })}
      />
      {measure.unit === "custom" && (
        <TextField
          label="Unidad personalizada"
          value={measure.customLabel ?? ""}
          maxLength={30}
          onChange={(event) =>
            dispatch({
              type: "patch",
              patch: { measure: { ...measure, customLabel: event.target.value } },
            })
          }
        />
      )}
      {measure.unit === "done" ? (
        <p className={styles.hint}>
          Hecho / no hecho se mide por sesión: cada vez que lo haces, un toque.
        </p>
      ) : (
        <>
          <strong>2 · Dirección</strong>
          <Choices
            label="2 · Dirección"
            value={measure.direction}
            options={[
              { value: "reach", label: "Alcanzar", hint: "Más es mejor, hasta tu ideal." },
              {
                value: "limit",
                label: "No exceder",
                hint: "Menos es mejor. Registras cada día, aunque sea 0.",
              },
            ]}
            onChange={(direction) => dispatch({ type: "direction", direction })}
          />
          <strong>3 · Periodo</strong>
          <Choices
            label="3 · Periodo"
            value={measure.schedule.period}
            options={[
              {
                value: "perSession",
                label: "Por sesión",
                hint: "Cada vez que lo haces cuenta como una oportunidad.",
              },
              {
                value: "weeklyTotal",
                label: "Semanal acumulado",
                hint: "Sumas durante la semana; la semana entera es la oportunidad.",
              },
            ]}
            onChange={(period) => dispatch({ type: "period", period })}
          />
        </>
      )}
    </div>
  );
}
