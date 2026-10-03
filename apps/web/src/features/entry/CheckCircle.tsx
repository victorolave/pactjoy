import { Icon } from "../../ui/icon/Icon.tsx";
import styles from "./check-circle.module.css";

export interface CheckCircleProps {
  readonly label: string;
  /** Registered: the circle is filled green; a second tap is the way back. */
  readonly pressed: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

/** The one-tap control of a done/not done day (design 16): a 48 px circle that fills when logged. */
export function CheckCircle({ label, pressed, disabled = false, onClick }: CheckCircleProps) {
  return (
    <button
      type="button"
      className={styles.circle}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="check" />
    </button>
  );
}
