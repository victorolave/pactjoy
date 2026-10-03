import { IconButton } from "../../ui/IconButton.tsx";
import { Tag } from "../../ui/Tag.tsx";
import styles from "./entry.module.css";

export interface QuantityStepperProps {
  /** What is typed: a string, so a half-typed "1," is never lost. */
  readonly value: string;
  readonly unit: string;
  readonly presets: readonly string[];
  /** The text cannot be sent (zero, unreadable, too many decimals). */
  readonly invalid?: boolean;
  readonly onChange: (value: string) => void;
  readonly onStep: (direction: 1 | -1) => void;
}

/** A big editable number with - and + around it and shortcut values under it (design 17). */
export function QuantityStepper({
  value,
  unit,
  presets,
  invalid = false,
  onChange,
  onStep,
}: QuantityStepperProps) {
  return (
    <div className={styles.stepper}>
      <div className={styles.row}>
        <IconButton icon="minus" variant="outline" label="Menos" onClick={() => onStep(-1)} />
        <div className={styles.value}>
          <input
            className={styles.number}
            aria-label="Cantidad"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            {...(invalid ? { "aria-invalid": true } : {})}
          />
          <span className={styles.unit}>{unit}</span>
        </div>
        <IconButton icon="plus" variant="outline" label="Más" onClick={() => onStep(1)} />
      </div>
      {presets.length > 0 && (
        <div className={styles.presets}>
          {presets.map((preset) => (
            <Tag key={preset} selected={preset === value} onClick={() => onChange(preset)}>
              {`${preset} ${unit}`}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
