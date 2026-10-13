import { Button } from "../../../ui/Button.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { graduateCopy } from "../copy.ts";
import styles from "../season-close.module.css";

export interface GraduateSheetProps {
  readonly open: boolean;
  readonly habitName: string;
  readonly pending: boolean;
  readonly offline: boolean;
  /** "Sí, graduarlo": the member stays on their word; nothing is stored until the last habit. */
  readonly onConfirm: () => void;
  /** "Todavía no", Escape or the scrim: the graduation is dropped. */
  readonly onCancel: () => void;
}

/**
 * 38a: the graduation question, a bottom sheet over the decision. Graduation is the member's own
 * call and is never suggested more than by the highlighted option; permanence is stated.
 */
export function GraduateSheet({
  open,
  habitName,
  pending,
  offline,
  onConfirm,
  onCancel,
}: GraduateSheetProps) {
  return (
    <Sheet
      open={open}
      headless
      title={graduateCopy.meta(habitName)}
      onClose={onCancel}
      actions={
        <>
          <Button block onClick={onConfirm} disabled={pending || offline}>
            {graduateCopy.confirm}
          </Button>
          <Button block variant="ghost" onClick={onCancel} disabled={pending}>
            {graduateCopy.cancel}
          </Button>
        </>
      }
    >
      <div className={styles.sheetBody}>
        <Illustration name="graduar-habito" size="180" alt={graduateCopy.illustrationAlt} />
        <p className={styles.small}>{graduateCopy.meta(habitName)}</p>
        <h2 className={styles.sheetTitle}>{graduateCopy.title}</h2>
        <p className={styles.lead}>{graduateCopy.body}</p>
      </div>
    </Sheet>
  );
}
