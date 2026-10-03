import { useEffect, useRef } from "react";
import { pointsText } from "../../shared/format.ts";
import { Button } from "../../ui/Button.tsx";
import { Illustration } from "../../ui/Placeholder.tsx";
import styles from "./entry.module.css";

export interface ConfirmationProps {
  /** What was saved: "Leer · 20 min". */
  readonly detail: string;
  /** Points the registro earned, from the server; nothing is shown for `null` or zero. */
  readonly points?: number | null;
  /** One closing line under the points, when there is something to say. */
  readonly message?: string | null;
  readonly onClose: () => void;
}

/** The sheet's confirmation (design 20): illustration, what was saved, "+N pts" and one line. */
export function Confirmation({
  detail,
  points = null,
  message = null,
  onClose,
}: ConfirmationProps) {
  const root = useRef<HTMLDivElement>(null);
  // The save is the user's answer: focus lands on it (the sheet's old content is gone) and a status
  // region announces it, instead of focus falling back to the page body in silence.
  useEffect(() => root.current?.focus(), []);
  return (
    <div ref={root} className={styles.confirmation} role="status" tabIndex={-1}>
      {/* The text says it; the picture only decorates. */}
      <Illustration alt="" name="registro-guardado" size="lg" />
      <p className={styles.confirmationTitle}>Registro guardado.</p>
      <p className={styles.confirmationDetail}>{detail}</p>
      {points !== null && points > 0 && (
        <p className={styles.confirmationPoints}>{pointsText(points)}</p>
      )}
      {message !== null && <p className={styles.subtitle}>{message}</p>}
      <div className={styles.confirmationAction}>
        <Button block onClick={onClose}>
          Seguir con mi día
        </Button>
      </div>
    </div>
  );
}
