import type { KeyboardEvent, ReactNode } from "react";
import { useId } from "react";
import styles from "./Wizard.module.css";

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: ReactNode;
}

/** Button radios with roving focus; the full row is a >=44px target, including on iOS. */
export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  compact = false,
  iconsOnly = false,
}: {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly Choice<T>[];
  readonly onChange: (value: T) => void;
  readonly compact?: boolean;
  readonly iconsOnly?: boolean;
}) {
  const id = useId();
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = ["ArrowRight", "ArrowDown"].includes(event.key)
      ? 1
      : ["ArrowLeft", "ArrowUp"].includes(event.key)
        ? -1
        : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={compact ? styles.options : styles.choices}>
      {options.map((option, index) => {
        const checked = option.value === value;
        const first = !options.some((item) => item.value === value) && index === 0;
        return (
          // biome-ignore lint/a11y/useSemanticElements: button-based design-system radios match SegmentedControl
          <button
            type="button"
            key={option.value}
            role="radio"
            aria-checked={checked}
            aria-label={iconsOnly ? option.label : undefined}
            aria-describedby={!iconsOnly && option.hint ? `${id}-${index}-hint` : undefined}
            tabIndex={checked || first ? 0 : -1}
            className={styles.choice}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {option.icon}
            {!iconsOnly && (
              <span className={styles.choiceText}>
                <strong>{option.label}</strong>
                {option.hint && (
                  <span id={`${id}-${index}-hint`} className={styles.hint} aria-hidden="true">
                    {option.hint}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
