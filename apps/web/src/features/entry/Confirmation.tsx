import { useEffect } from "react";
import { Button } from "../../ui/Button.tsx";
import { Illustration } from "../../ui/Placeholder.tsx";
import styles from "./entry.module.css";

/** How long the confirmation stays before the sheet closes itself (EN-R6). */
const CONFIRMATION_MS = 1200;

/** Calls `onClose` after the confirmation time, once `saved` is set. */
export function useAutoClose(saved: string | null, onClose: () => void): void {
  useEffect(() => {
    if (saved === null) return;
    const timer = setTimeout(onClose, CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [saved, onClose]);
}

export function Confirmation({
  title = "Registro guardado.",
  detail,
  onClose,
}: {
  readonly title?: string;
  readonly detail: string;
  readonly onClose: () => void;
}) {
  return (
    <div className={styles.confirmation}>
      <Illustration alt={title.replace(/\.$/, "")} />
      <p className={styles.confirmationTitle}>{title}</p>
      <p className={styles.subtitle}>{detail}</p>
      <Button block onClick={onClose}>
        Seguir con mi día
      </Button>
    </div>
  );
}
