import { cx } from "./cx.ts";
import styles from "./ListRow.module.css";

export interface ListRowProps {
  readonly label: string;
  /** A read-only value on the right (the email). */
  readonly value?: string;
  /** Makes the row a button, styled as the design's link-coloured action. */
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /** `danger` colours an action that cannot be undone (deleting the account). */
  readonly tone?: "default" | "danger";
}

/**
 * One row of a settings list (design 40): a label with a value, or an action. Rows go inside a
 * `Card` with `flush`; the hairline between them comes from the list.
 */
export function ListRow({ label, value, onClick, disabled, tone = "default" }: ListRowProps) {
  if (onClick === undefined) {
    return (
      <div className={cx(styles.row, styles.info)}>
        <span>{label}</span>
        {value !== undefined && <span className={styles.value}>{value}</span>}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cx(styles.row, styles.action, tone === "danger" && styles.danger)}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
