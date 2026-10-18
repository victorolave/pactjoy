import { useState } from "react";
import { useNavigate } from "react-router";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { Card } from "../../../ui/Card.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { ListRow } from "../../../ui/ListRow.tsx";
import { useSession } from "../../auth/index.ts";
import { LeaveCircleSheet, useMyCircle } from "../../circle/index.ts";
import { NotificationsCard } from "../../notifications/index.ts";
import { DeleteAccountSheet } from "../delete-account/DeleteAccountSheet.tsx";
import styles from "./SettingsScreen.module.css";

const PROFILE_PATH = "/profile";

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
  const online = useOnline();

  const circle = data?.circle ?? null;

  const endSession = () => {
    if (signingOut) return;
    setSigningOut(true);
    // The device's push registration goes first (best effort), then the session ends locally; the
    // provider drops the cached data and the router leaves for /login.
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
          <ListRow label="Cerrar sesión" onClick={endSession} disabled={signingOut} />
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
