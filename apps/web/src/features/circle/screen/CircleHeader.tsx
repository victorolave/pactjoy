import { useState } from "react";
import { IconButton } from "../../../ui/IconButton.tsx";
import { RenameCircleSheet } from "../rename/RenameCircleSheet.tsx";
import styles from "./CircleScreen.module.css";

/** The circle's name with rename (WC-R9) and, when asked for, the way to the invite screen. */
export function CircleHeader({
  circleId,
  name,
  eyebrow,
  onInvite,
}: {
  readonly circleId: string;
  readonly name: string;
  /** The small line above the name ("Semana 5 de 8"). */
  readonly eyebrow?: string | null | undefined;
  readonly onInvite?: (() => void) | undefined;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <header className={styles.header}>
        <div>
          {eyebrow != null && <div className={styles.meta}>{eyebrow}</div>}
          <h1 className={styles.title}>{name}</h1>
        </div>
        <div className={styles.headerActions}>
          <IconButton icon="pencil" label="Renombrar círculo" onClick={() => setRenaming(true)} />
          {onInvite !== undefined && (
            <IconButton icon="user-plus" label="Invitar" onClick={onInvite} />
          )}
        </div>
      </header>
      <RenameCircleSheet
        circleId={circleId}
        currentName={name}
        open={renaming}
        onClose={() => setRenaming(false)}
      />
    </>
  );
}
