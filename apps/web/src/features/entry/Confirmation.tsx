import { useEffect, useRef } from "react";
import { pointsText } from "../../shared/format.ts";
import { Button } from "../../ui/Button.tsx";
import { Illustration } from "../../ui/Placeholder.tsx";
import styles from "./entry.module.css";

/** How long the confirmation stays before the sheet closes itself (EN-R6). */
const CONFIRMATION_MS = 1200;

/** Calls `onClose` after the confirmation time, once `saved` is set. */
export function useAutoClose(saved: string | null, onClose: () => void): void {
  // The latest callback runs when the timer fires: a re-render (Today refetching) must not restart it.
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (saved === null) return;
    const timer = setTimeout(() => latest.current(), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [saved]);
}

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
  return (
    <div className={styles.confirmation}>
      <Illustration alt="Registro guardado" name="registro-guardado" size="lg" />
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
