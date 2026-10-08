import type { CommitmentProgress } from "../../ports/wire.ts";
import { longDate } from "../../shared/format.ts";
import { quantityText } from "../../shared/row-labels.ts";
import { Sheet } from "../../ui/Sheet.tsx";
import styles from "./CommitmentScreen.module.css";

type Started = Extract<CommitmentProgress, { state: "active" | "ended" }>;
type Cell = Started["weeks"][number]["cells"][number];
type Evidence = Cell["evidence"][number];
type Measure = Started["commitment"]["measure"];

/** One registro in the app's own words: "30 min", "Hecho", "No salió". */
function valueText(value: Evidence["value"], measure: Measure): string {
  if (value.kind === "quantity") return quantityText(value.value, measure);
  return value.kind === "done" ? "Hecho" : "No salió";
}

export interface EvidenceSheetProps {
  readonly cell: Cell;
  readonly measure: Measure;
  readonly onClose: () => void;
}

/**
 * What a history cell holds, read-only (design 24a "Toca una…", photos are Lote 4): its day, each
 * registro behind it (a summed session can have several) with its note, and the late marker. The
 * server only sends authorized evidence; nothing here can edit it.
 */
export function EvidenceSheet({ cell, measure, onClose }: EvidenceSheetProps) {
  const day = cell.date ?? cell.evidence[0]?.forDate ?? "";
  return (
    <Sheet open title={longDate(day)} onClose={onClose}>
      <ul className={styles.evidence}>
        {cell.evidence.map((entry, index) => (
          // Registros arrive in the server's order and never reorder while the sheet is open.
          // biome-ignore lint/suspicious/noArrayIndexKey: entries carry no id by design
          <li key={index} className={styles.evidenceItem}>
            <span className={styles.label}>{valueText(entry.value, measure)}</span>
            {entry.note !== null && <p className={styles.muted}>{entry.note}</p>}
          </li>
        ))}
      </ul>
      {cell.late && <p className={styles.muted}>Registrado posteriormente</p>}
    </Sheet>
  );
}
