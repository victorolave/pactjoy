import type { ReactNode } from "react";
import type { SeasonResultsDto } from "../../../ports/wire.ts";
import { AutomaticityBar } from "../../../ui/AutomaticityBar.tsx";
import { Card } from "../../../ui/Card.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { automaticityLabel, percentText, shortDate } from "../close-format.ts";
import { resultsCopy } from "../copy.ts";
import styles from "../season-close.module.css";
import { FinalStandings } from "./FinalStandings.tsx";

export interface ResultsViewProps {
  readonly results: SeasonResultsDto;
  readonly onBack: () => void;
  /** The pinned action under the figures; the read-only route has none. */
  readonly footer?: ReactNode;
}

/**
 * 36 "Resultados": the member's own final figures, their numbers before the standings. A full page
 * outside the tab bar. The ribbon draws once and stops (none under reduced motion); there is no
 * confetti and no podium. Everything here is the viewer's: the automaticity is private.
 */
export function ResultsView({ results, onBack, footer }: ResultsViewProps) {
  const journeys = results.commitments.flatMap((row) => {
    const label = automaticityLabel(row.automaticity);
    return label === null ? [] : [{ row, label }];
  });
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.ribbon} aria-hidden="true" />
        <div className={styles.heroBack}>
          <IconButton icon="chevron-left" label={resultsCopy.back} onClick={onBack} />
        </div>
        <p className={styles.heroMeta}>
          {shortDate(results.actualStart)} – {shortDate(results.lastDay)}
        </p>
        <h1 className={styles.heroTitle}>{resultsCopy.title}</h1>
        <p className={styles.heroSubtitle}>
          {resultsCopy.subtitle(results.lengthWeeks, results.standings.memberCount > 1)}
        </p>
      </header>
      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.h3}>{resultsCopy.yourSeason}</h2>
          <section className={styles.stats} aria-label={resultsCopy.statsLabel}>
            <Card>
              <div className={styles.stat}>
                <div className={styles.statLabel}>{resultsCopy.points}</div>
                <div className={styles.statValue}>{results.totals.points}</div>
              </div>
            </Card>
            <Card>
              <div className={styles.stat}>
                <div className={styles.statLabel}>{resultsCopy.consistency}</div>
                <div className={styles.statValue}>
                  {percentText(results.totals.consistencyPercent)}
                </div>
              </div>
            </Card>
            <Card>
              <div className={styles.stat}>
                <div className={styles.statLabel}>{resultsCopy.ideal}</div>
                <div className={styles.statValue}>{percentText(results.totals.idealPercent)}</div>
              </div>
            </Card>
          </section>
        </section>
        {journeys.length > 0 && (
          <Card>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>{resultsCopy.automaticity}</h2>
              <span className={styles.meta}>{resultsCopy.automaticityMeta}</span>
            </div>
            <ul className={styles.meters}>
              {journeys.map(({ row, label }) => (
                <li key={row.commitmentId} className={styles.meterRow}>
                  <span className={styles.meterName}>{row.habitName}</span>
                  <AutomaticityBar
                    from={row.automaticity.from}
                    to={row.automaticity.to}
                    label={resultsCopy.automaticityRow(row.habitName, label)}
                  />
                  <span className={styles.meterValue}>{label}</span>
                </li>
              ))}
            </ul>
            <p className={styles.small}>{resultsCopy.automaticityNote}</p>
          </Card>
        )}
        {results.standings.memberCount > 1 && <FinalStandings seasonId={results.seasonId} />}
      </div>
      {footer !== undefined && <div className={styles.pageFooter}>{footer}</div>}
    </main>
  );
}
