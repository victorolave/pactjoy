import { type FormEvent, useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { useDeleteAccount } from "../queries.ts";
import styles from "./DeleteAccountSheet.module.css";
import { canConfirm } from "./delete-account.ts";

const ignore = () => {};

/**
 * Deleting the account (ADR-0019): immediate, with no undo, behind a typed word. The button stays
 * disabled until the word matches, while the request is in flight and offline. While it runs the
 * sheet cannot be dismissed (Cancelar, Escape or the scrim): closing would hide a deletion that
 * still goes through. Any failure reads the same and offers Reintentar with the typed word kept;
 * a 401 ends the session through the API layer's expire path, so it never reaches this sheet.
 * Success ends the session here, and the router leaves for /login with its own notice.
 */
export function DeleteAccountSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const remove = useDeleteAccount();
  const close = () => {
    remove.reset();
    onClose();
  };
  return (
    <Sheet open={open} title="Eliminar cuenta" headless onClose={remove.isPending ? ignore : close}>
      <DeleteForm remove={remove} onCancel={close} />
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so every opening starts with an empty field. */
function DeleteForm({
  remove,
  onCancel,
}: {
  readonly remove: ReturnType<typeof useDeleteAccount>;
  readonly onCancel: () => void;
}) {
  const online = useOnline();
  const [text, setText] = useState("");
  const failed = remove.isError;
  const ready = canConfirm(text) && online && !remove.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) remove.mutate();
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className={styles.content}>
        <h2 className={styles.title}>Eliminar cuenta</h2>
        <p className={styles.body}>
          Se borran tu correo, tu nombre, tus hábitos, notas y fotos, revisiones y avisos. Tus
          registros se quedan sin tu nombre para que la clasificación de tu círculo no cambie. No se
          puede deshacer.
        </p>
        <TextField
          label="Escribe ELIMINAR para confirmar"
          value={text}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          readOnly={remove.isPending}
          onChange={(event) => setText(event.target.value)}
        />
        {!online && <InlineMessage tone="pending" title="Sin conexión." />}
        {failed && <InlineMessage tone="error" title="No se pudo eliminar la cuenta" />}
      </div>
      <div className="pj-sheet__actions">
        <Button type="submit" block disabled={!ready}>
          {remove.isPending ? "Eliminando…" : failed ? "Reintentar" : "Eliminar mi cuenta"}
        </Button>
        <Button variant="ghost" block disabled={remove.isPending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
