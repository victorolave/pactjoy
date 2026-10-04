import styles from "./Avatar.module.css";
import { cx } from "./cx.ts";

const TINTS = ["orange", "coral", "pink", "purple", "cream"] as const;

/** A stable number from the name, so a person keeps their tint across screens and visits. */
function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) | 0;
  return Math.abs(value);
}

export interface AvatarProps {
  readonly name: string;
  readonly size?: "sm" | "md" | "xl" | "lg";
}

export function Avatar({ name, size = "md" }: AvatarProps) {
  const trimmed = name.trim();
  const tint = TINTS[hash(trimmed) % TINTS.length];
  return (
    <span
      className={cx(styles.avatar, styles[size])}
      role="img"
      aria-label={name}
      style={{ background: `var(--${tint}-200)` }}
    >
      {trimmed === "" ? "?" : trimmed.charAt(0).toUpperCase()}
    </span>
  );
}

export interface AvatarStackProps {
  readonly names: readonly string[];
  readonly size?: "sm" | "md";
  readonly max?: number;
}

export function AvatarStack({ names, size = "sm", max = 4 }: AvatarStackProps) {
  return (
    <span className={styles.stack}>
      {names.slice(0, max).map((name) => (
        <Avatar key={name} name={name} size={size} />
      ))}
    </span>
  );
}
