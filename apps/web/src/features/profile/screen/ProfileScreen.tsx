import { useState } from "react";
import { useNavigate } from "react-router";
import { useDeviceStore } from "../../../context/device-store-context.tsx";
import { Avatar } from "../../../ui/Avatar.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useSession } from "../../auth/index.ts";
import { useMyCircle } from "../../circle/index.ts";
import { RenameNameSheet } from "../rename/RenameNameSheet.tsx";
import { EmptySections } from "./EmptySections.tsx";
import styles from "./ProfileScreen.module.css";
import { profileName } from "./profile-name.ts";

/** Ajustes (design 40) lives outside the tab bar. */
export const SETTINGS_PATH = "/profile/settings";

/**
 * Perfil (design 39), minimal on purpose (Q5): an avatar with the initial, the displayName in the
 * circle and the email, then the design's sections in their empty state. With a circle the name can
 * be changed here (Q9, PS-R3); without one it falls back to the name draft, then the email.
 */
export function ProfileScreen() {
  const { session } = useSession();
  const { data, isError, fetchStatus } = useMyCircle();
  // The name step's draft (design D7: profile reaches circle and auth only, so it reads the device store itself).
  const draft = useDeviceStore().get("nameDraft");
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);

  const circle = data?.circle ?? null;
  const memberName = circle?.members.find((member) => member.isYou)?.displayName ?? null;
  const email = session?.email ?? null;
  const name = profileName({ memberName, draft, email });
  // Until the circle is known the name could still change, so it is not shown yet (no flash of the email).
  const loading = data === undefined && !isError && fetchStatus !== "paused";

  return (
    <section className={styles.screen}>
      <h1 className={styles.visuallyHidden}>Perfil</h1>
      <header className={styles.header}>
        <Avatar name={loading ? "" : name} size="xl" />
        <div className={styles.who} aria-busy={loading}>
          {loading ? <Skeleton shape="line" /> : <h2 className={styles.name}>{name}</h2>}
          {email !== null && <div className={styles.email}>{email}</div>}
        </div>
        <div className={styles.actions}>
          {circle !== null && (
            <IconButton icon="pencil" label="Cambiar mi nombre" onClick={() => setRenaming(true)} />
          )}
          <IconButton icon="settings" label="Ajustes" onClick={() => navigate(SETTINGS_PATH)} />
        </div>
      </header>
      <EmptySections />
      {circle !== null && memberName !== null && (
        <RenameNameSheet
          circleId={circle.id}
          currentName={memberName}
          open={renaming}
          onClose={() => setRenaming(false)}
        />
      )}
    </section>
  );
}
