import { IconButton } from "../../../ui/IconButton.tsx";
import { SegmentedControl } from "../../../ui/SegmentedControl.tsx";
import type { Frequency } from "./measure-defaults.ts";
import styles from "./Wizard.module.css";

export const WEEKDAYS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function FrequencyPicker({
  value,
  onChange,
}: {
  readonly value: Frequency;
  readonly onChange: (value: Frequency) => void;
}) {
  return (
    <div className={styles.frequency}>
      <strong>Frecuencia</strong>
      <SegmentedControl
        label="Tipo de frecuencia"
        value={value.kind}
        options={[
          { value: "timesPerWeek", label: "Veces por semana" },
          { value: "specificDays", label: "Días concretos" },
        ]}
        onChange={(kind) =>
          onChange(kind === "timesPerWeek" ? { kind, times: 5 } : { kind, weekdays: [1, 3, 5] })
        }
      />
      {value.kind === "timesPerWeek" ? (
        <fieldset className={styles.frequencyCard} aria-label="Frecuencia">
          <IconButton
            icon="minus"
            label="Restar veces por semana"
            variant="outline"
            disabled={value.times <= 1}
            onClick={() => onChange({ ...value, times: value.times - 1 })}
          />
          <output
            aria-label={`Frecuencia: ${value.times} ${value.times === 1 ? "vez" : "veces"} por semana`}
          >
            {value.times} {value.times === 1 ? "vez" : "veces"} por semana
          </output>
          <IconButton
            icon="plus"
            label="Sumar veces por semana"
            variant="outline"
            disabled={value.times >= 7}
            onClick={() => onChange({ ...value, times: value.times + 1 })}
          />
        </fieldset>
      ) : (
        <fieldset className={styles.days} aria-label="Días de la semana">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              className={styles.day}
              aria-label={WEEKDAYS[day]}
              aria-pressed={value.weekdays.includes(day)}
              onClick={() =>
                onChange({
                  ...value,
                  weekdays: value.weekdays.includes(day)
                    ? value.weekdays.filter((d) => d !== day)
                    : [...value.weekdays, day].sort((a, b) => a - b),
                })
              }
            >
              {day === 2 ? "X" : WEEKDAYS[day].charAt(0)}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}
