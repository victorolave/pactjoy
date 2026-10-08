import { Icon } from "../../ui/icon/Icon.tsx";
import styles from "./HabitGlyph.module.css";
import { iconFor } from "./icon-catalog.ts";

export type HabitTint = "orange" | "pink" | "purple" | "coral" | "cream" | "neutral";

/** The design's colour per habit icon (23a, 23d); an icon it does not colour stays neutral. */
const TINTS: Readonly<Record<string, HabitTint>> = {
  book: "orange",
  palette: "pink",
  brain: "purple",
  flower: "purple",
  footprints: "coral",
  dumbbell: "coral",
  coffee: "cream",
};

export function habitTint(icon: string | null): HabitTint {
  return (icon !== null && TINTS[icon]) || "neutral";
}

export interface HabitGlyphProps {
  /** The habit's persisted icon key (`null` when it has none). */
  readonly icon: string | null;
  /** A private commitment seen by another member: the muted eye-off glyph, never its icon. */
  readonly hidden?: boolean;
}

/** The 36 px tinted tile that stands for a habit in a list row. Decorative: the row names it. */
export function HabitGlyph({ icon, hidden = false }: HabitGlyphProps) {
  const tint = hidden ? "muted" : habitTint(icon);
  return (
    <span className={styles.tile} data-tint={tint} aria-hidden="true">
      <Icon name={hidden ? "eye-off" : iconFor(icon)} size="sm" />
    </span>
  );
}
