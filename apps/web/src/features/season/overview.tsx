import type { ReactNode } from "react";
import type { SeasonProgress } from "../../ports/wire.ts";
import { SeasonCommitmentRow } from "./commitment-row.tsx";
import styles from "./Overview.module.css";
import { Standings } from "./standings.tsx";

type StartedSeason = Extract<SeasonProgress, { state: "active" | "ended" }>;

export interface SeasonOverviewProps {
  readonly progress: SeasonProgress;
  readonly chartSlot?: ReactNode;
  readonly onNavigateToMember?: ((memberId: string) => void) | undefined;
  readonly onNavigateToCommitment?: ((commitmentId: string) => void) | undefined;
}

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso;
}

const percentText = (v: number | null): string => (v === null ? "—" : `${v} %`);

export function SeasonOverview({
  progress,
  chartSlot,
  onNavigateToMember,
  onNavigateToCommitment,
}: SeasonOverviewProps) {
  if (progress.state === "notStarted") return null;

  const { circle, season, calendar, own, standings } = progress as StartedSeason;
  const currentPct = Math.min(100, Math.max(0, Math.round((calendar.dayOfWeek / 7) * 100)));

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <div className={styles.headerMeta}>
            {circle.name} · {season.lengthWeeks} semanas
          </div>
          <h1 className={styles.headerTitle}>
            Semana {calendar.weekIndex + 1} de {season.lengthWeeks}
          </h1>
          <div className={styles.headerSubtitle}>
            {`${shortDate(season.actualStart)} – ${shortDate(season.lastDay)} · día ${calendar.dayOfWeek} de esta semana`}
          </div>
        </div>

        <div
          className={styles.segmentsBar}
          style={{ gridTemplateColumns: `repeat(${season.lengthWeeks}, 1fr)` }}
          role="progressbar"
          aria-label="Progreso de la temporada"
          aria-valuenow={calendar.weekIndex + 1}
          aria-valuemin={1}
          aria-valuemax={season.lengthWeeks}
          aria-valuetext={`Semana ${calendar.weekIndex + 1} de ${season.lengthWeeks}`}
        >
          {Array.from({ length: season.lengthWeeks }, (_, i) => {
            const isPast = i < calendar.weekIndex;
            const isCurrent = i === calendar.weekIndex;
            if (isPast) {
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static progress segments
                  key={i}
                  className={`${styles.segment} ${styles.segmentFilled}`}
                />
              );
            }
            if (isCurrent) {
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static progress segments
                  key={i}
                  className={styles.segment}
                  style={{
                    background: `linear-gradient(90deg, var(--pj-ink) ${currentPct}%, var(--ink-200) ${currentPct}%)`,
                  }}
                />
              );
            }
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static progress segments
                key={i}
                className={styles.segment}
              />
            );
          })}
        </div>
      </header>

      <section className={styles.metricsSection} aria-label="Tu temporada">
        <h2 className={styles.sectionHeading}>Tu temporada</h2>
        <div className={styles.metricsGrid}>
          <div className={`pj-card ${styles.metricCard}`}>
            <span className={styles.metricLabel}>Puntos</span>
            <span className={styles.metricValue}>{own.points}</span>
            <span className={styles.metricMeta}>de 1.000</span>
          </div>
          <div className={`pj-card ${styles.metricCard}`}>
            <span className={styles.metricLabel}>Consistencia</span>
            <span className={styles.metricValue}>{percentText(own.consistency)}</span>
            <span className={styles.metricMeta}>mínimo cumplido</span>
          </div>
          <div className={`pj-card ${styles.metricCard}`}>
            <span className={styles.metricLabel}>Ideal</span>
            <span className={styles.metricValue}>{percentText(own.idealCompletion)}</span>
            <span className={styles.metricMeta}>del ideal completado</span>
          </div>
        </div>
      </section>

      <Standings
        standings={standings}
        season={season}
        calendar={calendar}
        onNavigateToMember={onNavigateToMember}
      />

      {chartSlot}

      {own.commitments.length > 0 && (
        <section className={styles.commitmentsSection} aria-label="Tus compromisos">
          <div className={styles.commitmentsHeader}>
            <h2 className={styles.sectionHeading}>Tus compromisos</h2>
            <span className={styles.commitmentsSubtitle}>Puntos / posibles</span>
          </div>
          <div className={`pj-card ${styles.commitmentsCard}`}>
            {own.commitments.map((row) => (
              <SeasonCommitmentRow
                key={row.commitmentId}
                row={row}
                onSelect={onNavigateToCommitment}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
