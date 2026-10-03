import { toScaled } from "../../shared/decimal.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { Tag } from "../../ui/Tag.tsx";
import { formatDecimal } from "../today/row-labels.ts";
import styles from "./entry.module.css";

export interface QuantityStepperProps {
  /** What is typed: a string, so a half-typed "1," is never lost. */
  readonly value: string;
  readonly unit: string;
  readonly presets: readonly string[];
  /** The text cannot be sent (zero, unreadable, too many decimals). */
  readonly invalid?: boolean;
  /** Shown before the number when the value is added on top of what is logged ("+10", design 22). */
  readonly prefix?: string;
  readonly onChange: (value: string) => void;
  readonly onStep: (direction: 1 | -1) => void;
}

const sameValue = (a: string, b: string): boolean => {
  const left = toScaled(a);
  return left !== null && left === toScaled(b);
};

/**
 * A big editable number with its unit right after it, - and + at either side and shortcut values
 * under it (design 17). Decimals read with a comma, as the rest of the app writes them.
 */
export function QuantityStepper({
  value,
  unit,
  presets,
  invalid = false,
  prefix,
  onChange,
  onStep,
}: QuantityStepperProps) {
  const shown = formatDecimal(value);
  return (
    <div className={styles.stepper}>
      <div className={styles.row}>
        <IconButton
          icon="minus"
          variant="outline"
          size="lg"
          label="Menos"
          onClick={() => onStep(-1)}
        />
        <div className={styles.value}>
          {prefix !== undefined && <span className={styles.prefix}>{prefix}</span>}
          <input
            className={styles.number}
            style={{ width: `${Math.max(shown.length, 1) + 1}ch` }}
            aria-label="Cantidad"
            inputMode="decimal"
            autoComplete="off"
            value={shown}
            onChange={(event) => onChange(event.target.value)}
            {...(invalid ? { "aria-invalid": true } : {})}
          />
          <span className={styles.unit}>{unit}</span>
        </div>
        <IconButton icon="plus" variant="outline" size="lg" label="Más" onClick={() => onStep(1)} />
      </div>
      {presets.length > 0 && (
        <div className={styles.presets}>
          {presets.map((preset) => (
            <Tag key={preset} selected={sameValue(preset, value)} onClick={() => onChange(preset)}>
              {`${formatDecimal(preset)} ${unit}`}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
