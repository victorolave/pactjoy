import { Card } from "../../ui/Card.tsx";
import { cx } from "../../ui/cx.ts";
import rows from "./rows/rows.module.css";
import styles from "./TodaySkeleton.module.css";

/** A row card as the design draws it while loading: the real row card, with blocks for its content. */
function SkeletonRow({
  height,
  first,
  second,
}: {
  readonly height: "tall" | "short";
  /** Widths of the two text lines, as a share of the row. */
  readonly first: "w40" | "w50";
  readonly second: "w60" | "w70";
}) {
  return (
    <Card as="div" flush data-skeleton="row">
      <div className={cx(rows.card, styles.row, height === "tall" ? styles.tall : styles.short)}>
        <div className={cx(rows.top, styles.top)}>
          <span data-skeleton="tile" className={cx(rows.glyph, styles.tile)} />
          <div className={rows.body}>
            <span
              data-skeleton="line"
              className={cx(styles.line, styles.lineTitle, styles[first])}
            />
            <span
              data-skeleton="line"
              className={cx(styles.line, styles.lineMeta, styles[second])}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * The loading body of Today (design 15e): a section title, two row cards (a tile and two lines each)
 * and the season card, pulsing together. The greeting and date above it are drawn by the screen, since
 * they need no server. The rows reuse the real row card's layout classes.
 */
export function TodaySkeleton() {
  return (
    <div className={styles.group} role="status" aria-busy="true" aria-label="Cargando Hoy">
      <div className={styles.pulse} aria-hidden="true">
        <span data-skeleton="title" className={styles.title} />
        <SkeletonRow height="tall" first="w40" second="w70" />
        <SkeletonRow height="short" first="w50" second="w60" />
        <Card as="div" data-skeleton="card">
          <div className={styles.season} />
        </Card>
      </div>
    </div>
  );
}
