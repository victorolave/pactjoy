import { useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "../../../ui/Card.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { ListRow } from "../../../ui/ListRow.tsx";
import { useSession } from "../../auth/index.ts";
import { LeaveCircleSheet, useMyCircle } from "../../circle/index.ts";
import styles from "./SettingsScreen.module.css";

const PROFILE_PATH = "/profile";

/**
 * Ajustes (design 40), minimal (Q6): the email, "Salir del círculo" (only with a circle) and
 * "Cerrar sesión". Appearance, notification switches, reminders and deleting the account come with
 * their own changes, so they are not here.
 */
export function SettingsScreen() {
  const { session, signOut } = useSession();
  const { data } = useMyCircle();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const circle = data?.circle ?? null;

  const endSession = () => {
    if (signingOut) return;
    setSigningOut(true);
    // The session ends locally first; the provider drops the cached data and the router leaves for /login.
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
        </Card>
      </div>
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
