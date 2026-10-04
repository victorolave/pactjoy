import { useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { useSession } from "../auth/index.ts";
import styles from "./ProfileScreen.module.css";

/**
 * A minimal Perfil: who is signed in and the way out. The rest of the design's profile (Lote 5) comes
 * with its own change; without this there was no way to end a session from the app.
 */
export function ProfileScreen() {
  const { session, signOut } = useSession();
  const [leaving, setLeaving] = useState(false);

  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    // The session ends locally first; the provider drops the cached data and the router leaves for /login.
    void signOut();
  };

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>Perfil</h1>
      {session?.email != null && <p className={styles.email}>{session.email}</p>}
      <Button variant="secondary" block disabled={leaving} onClick={leave}>
        Cerrar sesión
      </Button>
    </section>
  );
}
