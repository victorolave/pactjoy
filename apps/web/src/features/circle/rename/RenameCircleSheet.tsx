import { type FormEvent, useState } from "react";
import { useToasts } from "../../../context/toast-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { circleFailure } from "../circle-messages.ts";
import { useRenameCircle } from "../queries.ts";
import styles from "./RenameCircleSheet.module.css";

/**
 * Renames the circle (WC-R9): any member can. A refused name stays under the field, any other
 * failure (offline, server) is a message in the sheet, and the typed text is never lost. Success
 * closes the sheet; the tab updates when `myCircle` is refetched.
 */
export function RenameCircleSheet({
  circleId,
  currentName,
  open,
  onClose,
}: {
  readonly circleId: string;
  readonly currentName: string;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Renombrar círculo" onClose={onClose}>
      <RenameForm circleId={circleId} currentName={currentName} onClose={onClose} />
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so every opening starts from the current name. */
function RenameForm({
  circleId,
  currentName,
  onClose,
}: {
  readonly circleId: string;
  readonly currentName: string;
  readonly onClose: () => void;
}) {
  const rename = useRenameCircle(circleId);
  const toasts = useToasts();
  const [name, setName] = useState(currentName);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rename.isPending) return;
    setFailure(undefined);
    if (name.trim() === "") {
      setFieldError("Ponle un nombre al círculo.");
      return;
    }
    setFieldError(undefined);
    try {
      await rename.mutateAsync(name.trim());
      toasts.show({ message: "Nombre actualizado." });
      onClose();
    } catch (error) {
      const { message, field } = circleFailure(error);
      if (field === "name") setFieldError(message);
      else setFailure(message);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label="Nombre del círculo"
        hint="Lo verán todos los miembros."
        value={name}
        enterKeyHint="done"
        onChange={(event) => {
          setName(event.target.value);
          setFieldError(undefined);
        }}
        {...(fieldError === undefined ? {} : { error: fieldError })}
      />
      {failure !== undefined && <InlineMessage tone="error" title={failure} />}
      <div className="pj-sheet__actions">
        <Button type="submit" block disabled={rename.isPending}>
          Guardar
        </Button>
        <Button variant="ghost" block onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
