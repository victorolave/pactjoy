import { IconButton } from "../../../ui/IconButton.tsx";
import styles from "./CircleScreen.module.css";

/** The circle's name and, when asked for, the way to the invite screen. */
export function CircleHeader({
  name,
  eyebrow,
  onInvite,
}: {
  readonly name: string;
  /** The small line above the name ("Semana 5 de 8"). */
  readonly eyebrow?: string | null | undefined;
  readonly onInvite?: (() => void) | undefined;
}) {
  return (
    <header className={styles.header}>
      <div>
        {eyebrow != null && <div className={styles.meta}>{eyebrow}</div>}
        <h1 className={styles.title}>{name}</h1>
      </div>
      <div className={styles.headerActions}>
        {onInvite !== undefined && (
          <IconButton icon="user-plus" label="Invitar" onClick={onInvite} />
        )}
      </div>
    </header>
  );
}
