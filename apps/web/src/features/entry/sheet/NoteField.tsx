import { useId, useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import styles from "../entry.module.css";

export interface NoteFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string;
}

/** An optional note, collapsed until asked for. Photos are not built (P2). */
export function NoteField({ value, onChange, error }: NoteFieldProps) {
  const [open, setOpen] = useState(value !== "" || error !== undefined);
  const id = useId();
  const errorId = `${id}-error`;

  if (!open) {
    return (
      <Button variant="ghost" block leadingIcon="message-square-plus" onClick={() => setOpen(true)}>
        Añadir nota
      </Button>
    );
  }
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
          aria-describedby={error === undefined ? undefined : errorId}
          {...(error === undefined ? {} : { "aria-invalid": true })}
        />
        {error !== undefined && (
          <span id={errorId} className="pj-field__error">
            <Icon name="circle-alert" size="sm" />
            {error}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        block
        onClick={() => {
          onChange("");
          setOpen(false);
        }}
      >
        Quitar nota
      </Button>
    </div>
  );
}
