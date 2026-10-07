import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { ProgressBar } from "../../../ui/ProgressBar.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useScoringPreview } from "../queries.ts";
import type { WizardMeasure } from "./measure-defaults.ts";
import styles from "./Wizard.module.css";
import { previewNote, previewPeriod, unitSuffix } from "./wizard-copy.ts";

/** Only the API computes scores. Debounce the entire command, including sample values. */
export function ScoringPreview({ measure }: { readonly measure: WizardMeasure }) {
  const query = useScoringPreview(measure);
  const displayMeasure = query.data?.measure ?? measure;

  return (
    <section
      className={styles.preview}
      aria-label="Así puntúa"
      aria-live="polite"
      aria-busy={query.isPending || query.isFetching}
    >
      <div className={styles.row}>
        <strong>Así puntúa</strong>
        <span>{previewPeriod(measure)}</span>
      </div>
      {query.isError ? (
        <InlineMessage
          tone="error"
          title="Algo salió mal"
          action={
            <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          }
        >
          Revisa tu conexión e inténtalo de nuevo.
        </InlineMessage>
      ) : query.data === undefined ? (
        <Skeleton shape="line" lines={3} />
      ) : (
        query.data.result.rows.map((row) => {
          const label =
            displayMeasure.unit === "done"
              ? row.value === "0"
                ? "No hecho"
                : "Hecho"
              : `${row.value} ${unitSuffix(displayMeasure)}`;
          return (
            <div key={row.value} className={styles.previewRow}>
              <span>{label}</span>
              <ProgressBar
                name={label}
                value={Number(row.progressPercent)}
                max={100}
                tone={row.progressPercent === "100" ? "success" : "ink"}
                track="white"
              />
              <strong>{row.progressPercent} %</strong>
            </div>
          );
        })
      )}
      <p className={styles.hint}>{previewNote(measure)}</p>
    </section>
  );
}
