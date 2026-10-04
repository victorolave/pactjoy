import { type FormEvent, useState } from "react";
import { useToasts } from "../../../context/toast-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { circleFailure, displayNameProblem, useRenameMyDisplayName } from "../../circle/index.ts";
import styles from "./RenameNameSheet.module.css";

/**
 * Changes the viewer's own displayName in the circle (Q9, PS-R3). Up to 30 characters, unique in the
 * circle without regard to case; the server is the judge of that, and its refusal stays under the
 * field with the typed text kept. Any other failure is a message in the sheet. Success closes it and
 * both Perfil and the Circle tab update when `myCircle` is refetched.
 */
export function RenameNameSheet({
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
    <Sheet open={open} title="Cambiar mi nombre" onClose={onClose}>
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
  const rename = useRenameMyDisplayName(circleId);
  const toasts = useToasts();
  const [name, setName] = useState(currentName);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rename.isPending) return;
    setFailure(undefined);
    const problem = displayNameProblem(name);
    if (problem !== null) {
      setFieldError(problem);
      return;
    }
    setFieldError(undefined);
    try {
      await rename.mutateAsync(name.trim());
      toasts.show({ message: "Nombre actualizado." });
      onClose();
    } catch (error) {
      const { message, field } = circleFailure(error);
      if (field === "displayName") setFieldError(message);
      else setFailure(message);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label="Tu nombre en el círculo"
        hint="Lo verán las personas de tu círculo."
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
