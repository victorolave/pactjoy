import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  readonly shape: "line" | "card" | "circle";
  /** How many stacked blocks to draw. */
  readonly lines?: number;
}

/** Loading placeholder. Hidden from assistive tech: the owning screen announces the loading. */
export function Skeleton({ shape, lines = 1 }: SkeletonProps) {
  return (
    <div className={styles.group} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        // The blocks are identical and never reorder, so the index is a stable key.
        // biome-ignore lint/suspicious/noArrayIndexKey: static decorative list
        <div key={index} className={`${styles.block} ${styles[shape]}`} />
      ))}
    </div>
  );
}
