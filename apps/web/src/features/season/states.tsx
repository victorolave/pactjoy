import type { ReactNode } from "react";
import { Navigate } from "react-router";
import type { SeasonProgress } from "../../ports/wire.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { Illustration } from "../../ui/Placeholder.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { useMyCircle } from "../circle/index.ts";
import { useSeasonProgress } from "../season-progress-data/index.ts";
import { SeasonCommitmentRow } from "./commitment-row.tsx";
import { SeasonOverview } from "./overview.tsx";
import styles from "./States.module.css";

type StartedSeason = Extract<SeasonProgress, { state: "active" | "ended" }>;

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

/**
 * Returns true if the season is in its first-day all-zero state (screen 23b).
 * Requires week 1, day 1, and 0 accumulated points across members.
 */
export function isFirstDayZero(progress: SeasonProgress): boolean {
  if (progress.state === "notStarted") return false;
  const { calendar, own, standings } = progress;
  if (calendar.weekIndex !== 0 || calendar.dayOfWeek !== 1) return false;

  if (standings.memberCount > 1) {
    return standings.rows.length > 0 && standings.rows.every((row) => row.points === 0);
  }
  return own.points === 0;
}

export interface SeasonFirstDayZeroProps {
  readonly progress: SeasonProgress;
  readonly onNavigateToMember?: ((memberId: string) => void) | undefined;
  readonly onNavigateToCommitment?: ((commitmentId: string) => void) | undefined;
}

/** Screen 23b: Primer día · aún sin puntos. */
export function SeasonFirstDayZero({
  progress,
  onNavigateToMember,
  onNavigateToCommitment,
}: SeasonFirstDayZeroProps) {
  if (progress.state === "notStarted") {
    return <Navigate to="/" replace />;
  }

  const { circle, season, calendar, own, standings } = progress as StartedSeason;
  const currentPct = Math.min(100, Math.max(0, Math.round((calendar.dayOfWeek / 7) * 100)));
  const isSolo = standings.memberCount <= 1;
  const isPair = standings.memberCount === 2;

  const heroCopy = isSolo
    ? "Tienes 1.000 puntos posibles, repartidos según tus compromisos. Aquí verás cómo avanzas."
    : isPair
      ? "Cada uno tiene 1.000 puntos posibles, repartidos según sus compromisos. Aquí verás cómo avanzan los dos."
      : "Cada uno tiene 1.000 puntos posibles, repartidos según sus compromisos. Aquí verás cómo avanzan todos.";

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
            {`${shortDate(season.actualStart)} – ${shortDate(season.lastDay)} · día 1`}
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

      <div className={`pj-card ${styles.heroCard}`}>
        <Illustration
          name="caminar"
          size="caminar"
          alt="Una mujer camina con una cinta de color a su alrededor"
        />
        <h2 className={styles.heroTitle}>La temporada empieza hoy.</h2>
        <p className={styles.heroBody}>{heroCopy}</p>
      </div>

      {!isSolo && (
        <div className={`pj-card ${styles.standingsCard}`}>
          <span className={styles.standingsLabel}>Así va la temporada</span>
          <ol className={styles.standingsList}>
            {standings.rows.map((row) => {
              const content = (
                <>
                  <Avatar name={row.displayName} size={28} />
                  <span className={styles.standingsName}>{row.displayName}</span>
                  <span className={styles.standingsPoints}>{row.points} pts</span>
                </>
              );

              if (!isPair && !row.isViewer && onNavigateToMember) {
                const accessibleName = `${row.displayName}, ${row.points} pts`;
                const hintId = `hint-season-zero-${row.memberId}`;
                return (
                  <li key={row.memberId}>
                    <button
                      type="button"
                      className={styles.standingsRowInteractive}
                      onClick={() => onNavigateToMember(row.memberId)}
                      aria-label={accessibleName}
                      aria-describedby={hintId}
                    >
                      {content}
                      <span id={hintId} className={styles.visuallyHidden}>
                        Ver la temporada de {row.displayName}
                      </span>
                    </button>
                  </li>
                );
              }

              return (
                <li key={row.memberId} className={styles.standingsRow}>
                  {content}
                </li>
              );
            })}
          </ol>
          <div className={styles.standingsFooter}>Todavía nadie ha registrado.</div>
        </div>
      )}

      {isSolo && own.commitments.length > 0 && (
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

export interface SeasonErrorProps {
  readonly circleName?: string | undefined;
  readonly lengthWeeks?: number | undefined;
  readonly weekNumber?: number | undefined;
  readonly onRetry?: (() => void) | undefined;
}

/** Screen 23c: Error de carga. */
export function SeasonError({ circleName, lengthWeeks, weekNumber, onRetry }: SeasonErrorProps) {
  const hasMetadata =
    circleName !== undefined && lengthWeeks !== undefined && weekNumber !== undefined;

  return (
    <div className={styles.errorScreen}>
      <header className={styles.header}>
        {hasMetadata ? (
          <div>
            <div className={styles.headerMeta}>
              {circleName} · {lengthWeeks} semanas
            </div>
            <h1 className={styles.headerTitle}>
              Semana {weekNumber} de {lengthWeeks}
            </h1>
          </div>
        ) : (
          <h1 className={styles.headerTitle}>Temporada</h1>
        )}
      </header>

      <div className={styles.errorCenter} role="alert">
        <span className={styles.errorGlyph}>
          <Icon name="cloud-off" size={32} />
        </span>
        <h2 className={styles.errorTitle}>No pudimos cargar la temporada.</h2>
        <p className={styles.errorSubtitle}>Tus registros están a salvo. Inténtalo de nuevo.</p>
        {onRetry !== undefined && (
          <Button leadingIcon="rotate-cw" onClick={onRetry}>
            Reintentar
          </Button>
        )}
      </div>
    </div>
  );
}

/** Loading skeleton for Season screen. */
export function SeasonSkeleton() {
  return (
    <div
      className={styles.skeletonScreen}
      role="status"
      aria-busy="true"
      aria-label="Cargando temporada"
    >
      <div className={styles.skeletonHeader}>
        <Skeleton shape="line" lines={2} />
      </div>
      <Skeleton shape="card" lines={3} />
    </div>
  );
}

interface SeasonActiveScreenProps {
  readonly seasonId: string;
  readonly circleName?: string | undefined;
  readonly lengthWeeks?: number | undefined;
  readonly chartSlot?: ReactNode;
  readonly onNavigateToMember?: ((memberId: string) => void) | undefined;
  readonly onNavigateToCommitment?: ((commitmentId: string) => void) | undefined;
}

function SeasonActiveScreen({
  seasonId,
  circleName,
  lengthWeeks,
  chartSlot,
  onNavigateToMember,
  onNavigateToCommitment,
}: SeasonActiveScreenProps) {
  const query = useSeasonProgress(seasonId);

  if (query.data === undefined) {
    if (query.isError) {
      return (
        <SeasonError
          circleName={circleName}
          lengthWeeks={lengthWeeks}
          weekNumber={1}
          onRetry={() => void query.refetch()}
        />
      );
    }
    return <SeasonSkeleton />;
  }

  const { data } = query;
  if (data.state === "notStarted") {
    return <Navigate to="/" replace />;
  }

  if (isFirstDayZero(data)) {
    return (
      <SeasonFirstDayZero
        progress={data}
        onNavigateToMember={onNavigateToMember}
        onNavigateToCommitment={onNavigateToCommitment}
      />
    );
  }

  return (
    <SeasonOverview
      progress={data}
      chartSlot={chartSlot}
      onNavigateToMember={onNavigateToMember}
      onNavigateToCommitment={onNavigateToCommitment}
    />
  );
}

export interface SeasonScreenProps {
  readonly seasonId?: string | undefined;
  readonly chartSlot?: ReactNode;
  readonly onNavigateToMember?: ((memberId: string) => void) | undefined;
  readonly onNavigateToCommitment?: ((commitmentId: string) => void) | undefined;
}

/**
 * Connected Season container.
 * Coordinates lifecycle states (noCircle, noSeason, pactOpen, notStarted),
 * query loading/error (23c), first-day zero state (23b), and season overview (23a).
 */
export function SeasonScreen({
  seasonId: propSeasonId,
  chartSlot,
  onNavigateToMember,
  onNavigateToCommitment,
}: SeasonScreenProps = {}) {
  const myCircleQuery = useMyCircle();

  if (propSeasonId !== undefined) {
    return (
      <SeasonActiveScreen
        seasonId={propSeasonId}
        chartSlot={chartSlot}
        onNavigateToMember={onNavigateToMember}
        onNavigateToCommitment={onNavigateToCommitment}
      />
    );
  }

  const { data, isError, refetch } = myCircleQuery;

  if (data === undefined) {
    if (isError) {
      return <SeasonError onRetry={() => void refetch()} />;
    }
    return <SeasonSkeleton />;
  }

  const { circle, season } = data;

  if (circle === null) {
    return <Navigate to="/" replace />;
  }

  if (season === null) {
    return <Navigate to="/season/new" replace />;
  }

  if (season.phase === "pactOpen") {
    return <Navigate to={`/season/${season.id}/pact`} replace />;
  }

  return (
    <SeasonActiveScreen
      seasonId={season.id}
      circleName={circle.name}
      lengthWeeks={season.lengthWeeks}
      chartSlot={chartSlot}
      onNavigateToMember={onNavigateToMember}
      onNavigateToCommitment={onNavigateToCommitment}
    />
  );
}
