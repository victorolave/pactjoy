import type { KeyboardEvent } from "react";

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly label: string;
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

/** A radio group: one tab stop (the checked option), arrow keys move the selection. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(from + step + options.length) % options.length];
    if (next === undefined) return;
    onChange(next.value);
    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
    radios?.[(from + step + options.length) % options.length]?.focus();
  };

  return (
    <div className="pj-seg" role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: the design-system control is button-based by design
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="pj-seg__opt"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
