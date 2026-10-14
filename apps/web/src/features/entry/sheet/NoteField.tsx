import { type ReactNode, useId, useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import styles from "../entry.module.css";

export interface NoteFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string;
  /** Who sees what is written here, under the text area ("Visible para el círculo…" / "Solo tú la verás"). */
  readonly hint?: string;
  /** The photo field. When present the toggle covers the note AND the photo (design 19). */
  readonly photo?: ReactNode;
  /** Opens the section at the start even without a note (the entry already has a photo). */
  readonly startOpen?: boolean;
  /** Called when "Quitar nota y foto" is pressed, so the owner drops the photo too. */
  readonly onClear?: () => void;
}

/** The optional note (and photo), collapsed until asked for. */
export function NoteField({
  value,
  onChange,
  error,
  hint,
  photo,
  startOpen = false,
  onClear,
}: NoteFieldProps) {
  const [open, setOpen] = useState(startOpen || value !== "" || error !== undefined);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const withPhoto = photo !== undefined;

  if (!open) {
    return (
      <Button variant="ghost" block leadingIcon="message-square-plus" onClick={() => setOpen(true)}>
        {withPhoto ? "Añadir nota o foto" : "Añadir nota"}
      </Button>
    );
  }
  const describedBy = [error === undefined ? null : errorId, hint === undefined ? null : hintId]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className={styles.note}>
      <div className="pj-field">
        <label className="pj-field__label" htmlFor={id}>
          Nota (opcional)
        </label>
        <textarea
          id={id}
          className="pj-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          {...(error === undefined ? {} : { "aria-invalid": true })}
        />
        {hint !== undefined && (
          <span id={hintId} className="pj-field__hint">
            {hint}
          </span>
        )}
        {error !== undefined && (
          <span id={errorId} className="pj-field__error">
            <Icon name="circle-alert" size="sm" />
            {error}
          </span>
        )}
      </div>
      {photo}
      <Button
        variant="ghost"
        block
        onClick={() => {
          onChange("");
          onClear?.();
          setOpen(false);
        }}
      >
        {withPhoto ? "Quitar nota y foto" : "Quitar nota"}
      </Button>
    </div>
  );
}
