import { type InputHTMLAttributes, useEffect, useId, useRef } from "react";
import { Icon } from "./icon/Icon.tsx";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> {
  readonly label: string;
  readonly hint?: string;
  /** Replaces the hint, marks the input invalid and is announced with it. */
  readonly error?: string;
}

export function TextField({ label, hint, error, ...rest }: TextFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // A validation failure sends the user to the field that needs fixing.
  useEffect(() => {
    if (error !== undefined) input.current?.focus();
  }, [error]);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error !== undefined ? errorId : hint !== undefined ? hintId : undefined;
  return (
    <div className="pj-field">
      <label className="pj-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={input}
        id={id}
        className="pj-input"
        aria-describedby={describedBy}
        {...(error === undefined ? {} : { "aria-invalid": true })}
        {...rest}
      />
      {error === undefined && hint !== undefined && (
        <span id={hintId} className="pj-field__hint">
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span id={errorId} className="pj-field__error" role="alert">
          <Icon name="circle-alert" size="sm" />
          {error}
        </span>
      )}
    </div>
  );
}
