import { useId } from "react";
import type { CommitmentProgress } from "../../ports/wire.ts";
import styles from "./CommitmentScreen.module.css";
import { cellLabel, cellsHint } from "./commitment-labels.ts";

type Started = Extract<CommitmentProgress, { state: "active" | "ended" }>;
type Cell = Started["weeks"][number]["cells"][number];

/** The design's cell look per engine status (24a legend; 24b striped pause). */
function lookOf(cell: Cell, isToday: boolean): string {
  if (cell.status === "pending") return isToday ? "today" : "future";
  if (cell.status === "below" || cell.status === "missed" || cell.status === "unrecorded") {
    return "missed";
  }
  if (cell.status === "onHold") return "paused";
  return cell.status;
}

const LEGEND = [
  { look: "ideal", label: "Ideal" },
  { look: "minimum", label: "Mínimo" },
  { look: "missed", label: "No salió" },
  { look: "late", label: "Registrado posteriormente" },
  { look: "today", label: "Hoy" },
] as const;

/**
 * The season's history, one row per week (S1, S2…) and one cell per ENGINE opportunity: scheduled
 * days, the best-N sessions, or the week itself for a weekly total. Nothing here decides a status.
 */
export function HistoryGrid({ view }: { readonly view: Started }) {
  const headingId = useId();
  const columns = Math.max(1, ...view.weeks.map((week) => week.cells.length));
  const hint = cellsHint(view.commitment);
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.h2}>
        Historial
      </h2>
      <div className={`pj-card ${styles.card}`}>
        <ol className={styles.weeks} aria-labelledby={headingId}>
          {view.weeks.map((week) => (
            <li
              key={week.weekIndex}
              className={styles.week}
              // A 40 px week label, then as many equal columns as the widest week has opportunities.
              style={{ gridTemplateColumns: `var(--control-height-sm) repeat(${columns}, 1fr)` }}
            >
              <span className={styles.weekLabel}>{`S${week.weekIndex + 1}`}</span>
              {week.cells.map((cell, index) => {
                const isToday = cell.date === view.calendar.today;
                const label = cellLabel(cell, isToday);
                const look = lookOf(cell, isToday);
                return (
                  <span
                    // Cells are the engine's opportunities in order; they never reorder.
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional slots of one week
                    key={index}
                    className={styles.cell}
                    data-look={look}
                    data-compact={view.commitment.measure.unit === "done" || undefined}
                    {...(label === null
                      ? { "aria-hidden": true }
                      : { role: "img", "aria-label": label })}
                  >
                    {look === "today" ? "Hoy" : cell.status === "paused" ? "Pausa" : null}
                    {cell.late && <span className={styles.lateDot} />}
                  </span>
                );
              })}
            </li>
          ))}
        </ol>
        <div className={styles.legend} aria-hidden="true">
          {LEGEND.map((item) => (
            <span key={item.look} className={styles.legendItem}>
              <span className={styles.legendSwatch} data-look={item.look} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      {hint !== null && <p className={styles.muted}>{hint}</p>}
    </section>
  );
}
