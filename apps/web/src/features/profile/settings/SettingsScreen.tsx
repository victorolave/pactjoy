import { useState } from "react";
import { useNavigate } from "react-router";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { ListRow } from "../../../ui/ListRow.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { SIGN_OUT_GRACE_MS, useSession } from "../../auth/index.ts";
import { LeaveCircleSheet, useMyCircle } from "../../circle/index.ts";
import { type Outbox, useOutbox, useOutboxState } from "../../entry/index.ts";
import { NotificationsCard } from "../../notifications/index.ts";
import { DeleteAccountSheet } from "../delete-account/DeleteAccountSheet.tsx";
import styles from "./SettingsScreen.module.css";

const PROFILE_PATH = "/profile";

/**
 * How long "Cerrar sesión" waits for the queued entries to be sent before it asks: the one
 * sign-out grace (OE-R6), not a second window on top of it.
 */
const SEND_BEFORE_SIGN_OUT_MS = SIGN_OUT_GRACE_MS;

/** Settles when the replay does or after `ms`, whichever is first; never rejects. */
async function sendWithin(outbox: Outbox, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([
      outbox.drain().then(
        () => undefined,
        () => undefined,
      ),
      limit,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Placeholder Spanish copy, listed for owner approval. */
function unsentText(count: number): string {
  return count === 1
    ? "1 registro guardado en este teléfono todavía no se envió. Si cierras sesión, se borrará."
    : `${count} registros guardados en este teléfono todavía no se enviaron. Si cierras sesión, se borrarán.`;
}

/**
 * Ajustes (design 40), minimal (Q6): the email, "Salir del círculo" (only with a circle),
 * "Cerrar sesión", "Eliminar cuenta" (ADR-0019) and this device's notifications (ADR-0017).
 * Appearance and per-kind notification switches come with their own changes, so they are not here.
 */
export function SettingsScreen() {
  const { session, signOut } = useSession();
  const { data } = useMyCircle();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const online = useOnline();
  const outbox = useOutbox();
  const unsent = useOutboxState().items.length;

  const circle = data?.circle ?? null;

  const endSession = async () => {
    if (signingOut) return;
    setSigningOut(true);
    // Entries kept on the phone are sent first. If some cannot be (no connection, a server hiccup),
    // signing out would erase them: the member decides (OE-R6.S2, S3).
    if (outbox !== null && outbox.snapshot().items.length > 0) {
      if (online) await sendWithin(outbox, SEND_BEFORE_SIGN_OUT_MS);
      if (outbox.snapshot().items.length > 0) {
        setSigningOut(false);
        setConfirmingSignOut(true);
        return;
      }
    }
    // The device's push registration goes first (best effort), then the session ends locally; the
    // provider drops the cached data and the router leaves for /login.
    void signOut();
  };

  const signOutAnyway = () => {
    setConfirmingSignOut(false);
    setSigningOut(true);
    void signOut();
  };

  return (
    <FlowScreen title="Ajustes" onBack={() => navigate(PROFILE_PATH)} backLabel="Volver al perfil">
      <div className={styles.group}>
        <h2 className={styles.label}>Cuenta</h2>
        <Card flush>
          {session?.email != null && <ListRow label="Correo" value={session.email} />}
          {circle !== null && (
            <ListRow label="Salir del círculo" onClick={() => setLeaving(true)} />
          )}
          <ListRow label="Cerrar sesión" onClick={() => void endSession()} disabled={signingOut} />
          <ListRow
            label="Eliminar cuenta"
            tone="danger"
            onClick={() => setDeleting(true)}
            disabled={!online}
          />
        </Card>
      </div>
      <section className={styles.group} aria-labelledby="settings-notifications">
        <h2 id="settings-notifications" className={styles.label}>
          Avisos
        </h2>
        <NotificationsCard />
      </section>
      <Sheet
        open={confirmingSignOut}
        placement="center"
        title="Tienes registros sin enviar"
        onClose={() => setConfirmingSignOut(false)}
        actions={
          <>
            <Button block onClick={signOutAnyway}>
              Cerrar sesión igualmente
            </Button>
            <Button variant="ghost" block onClick={() => setConfirmingSignOut(false)}>
              Cancelar
            </Button>
          </>
        }
      >
        <p>{unsentText(unsent)}</p>
      </Sheet>
      <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
      {circle !== null && (
        <LeaveCircleSheet
          circle={circle}
          season={data?.season ?? null}
          open={leaving}
          onClose={() => setLeaving(false)}
        />
      )}
    </FlowScreen>
  );
}
