import { type ChangeEvent, type ClipboardEvent, useId, useRef, useState } from "react";
import styles from "./CodeInput.module.css";
import { cx } from "./cx.ts";

/**
 * What a typed or pasted text becomes: uppercase, only characters of `alphabet` (spaces, hyphens and
 * any other separator are dropped, so "abc-123" and " abc 123 " both give "ABC123"), at most
 * `length` of them.
 */
export function normalizeCode(raw: string, alphabet: string, length: number): string {
  let code = "";
  for (const char of raw.toUpperCase()) {
    if (alphabet.includes(char)) code += char;
  }
  return code.slice(0, length);
}

/** Separators people type or paste inside a code ("abc-123", "abc 123"): ignored without a fuss. */
const SEPARATORS = /[\s-]/gu;

/**
 * Whether `raw` has characters that are neither of the alphabet nor separators, i.e. ones that
 * {@link normalizeCode} silently drops and the user may not notice (a "0" where an "O" was meant).
 */
export function hasRejectedChars(raw: string, alphabet: string): boolean {
  for (const char of raw.replace(SEPARATORS, "").toUpperCase()) {
    if (!alphabet.includes(char)) return true;
  }
  return false;
}

export interface CodeInputProps {
  readonly label: string;
  /** The normalized code (see {@link normalizeCode}); the parent keeps it. */
  readonly value: string;
  readonly onChange: (code: string) => void;
  /** The characters a code can contain. */
  readonly alphabet: string;
  readonly length?: number;
  readonly invalid?: boolean;
  /** The id of the message that explains `invalid`, announced with the field. */
  readonly describedBy?: string | undefined;
  /**
   * Shown under the boxes (and announced with the field) right after typed or pasted characters
   * were dropped for being outside `alphabet`. It goes away on the next input that drops nothing
   * and once the code is complete. The copy belongs to the caller.
   */
  readonly rejectedHint?: string | undefined;
}

/**
 * A code drawn as one box per character, over ONE real input: so the keyboard, the paste menu,
 * autofill and screen readers all see a single text field. The boxes are decoration (aria-hidden);
 * the transparent input covers them and takes the taps.
 */
export function CodeInput({
  label,
  value,
  onChange,
  alphabet,
  length = 6,
  invalid = false,
  describedBy,
  rejectedHint,
}: CodeInputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [rejected, setRejected] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  const accept = (raw: string) => {
    setRejected(hasRejectedChars(raw, alphabet));
    onChange(normalizeCode(raw, alphabet, length));
  };
  const hint =
    rejected && rejectedHint !== undefined && value.length < length ? rejectedHint : null;
  const change = (event: ChangeEvent<HTMLInputElement>) => accept(event.target.value);
  // Pasting over a full code replaces it instead of being cut by the box limit.
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    accept(event.clipboardData.getData("text"));
  };
  // The caret always sits at the end, so Backspace removes the last box, as the boxes suggest.
  const caretToEnd = () => {
    const element = input.current;
    if (element !== null && element.selectionStart !== value.length) {
      element.setSelectionRange(value.length, value.length);
    }
  };

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.boxes}>
        <input
          ref={input}
          id={id}
          className={styles.input}
          value={value}
          onChange={change}
          onPaste={paste}
          onFocus={() => {
            setFocused(true);
            caretToEnd();
          }}
          onBlur={() => setFocused(false)}
          onSelect={caretToEnd}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-describedby={
            [describedBy, hint === null ? undefined : hintId].filter(Boolean).join(" ") || undefined
          }
          {...(invalid ? { "aria-invalid": true } : {})}
        />
        {Array.from({ length }, (_, index) => (
          <span
            // The boxes are positional and never reorder.
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size decorative list
            key={index}
            aria-hidden="true"
            className={cx(
              styles.box,
              invalid && styles.invalid,
              focused && !invalid && index === active && styles.active,
            )}
          >
            {value[index] ?? ""}
          </span>
        ))}
      </div>
      {hint !== null && (
        <p id={hintId} className="pj-field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}
