import { type ReactNode, useEffect, useRef } from "react";
import { Navigate } from "react-router";
import { ApiError } from "../../ports/api-error.ts";
import type { SeasonProgress } from "../../ports/wire.ts";
import { Button } from "../../ui/Button.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { Illustration } from "../../ui/Placeholder.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { useMyCircle } from "../circle/index.ts";
import { useSeasonProgress } from "../season-progress-data/index.ts";
import { SeasonCommitmentsList, SeasonHeader, SeasonOverview, shortDate } from "./overview.tsx";
import styles from "./States.module.css";
import { Standings } from "./standings.tsx";

type StartedSeason = Extract<SeasonProgress, { state: "active" | "ended" }>;

const NOT_VIEWABLE = new Set([400, 403, 404]);

function isNonRecoverableError(error: unknown): boolean {
  return error instanceof ApiError && NOT_VIEWABLE.has(error.status);
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
  const isSolo = standings.memberCount <= 1;
  const isPair = standings.memberCount === 2;

  const heroCopy = isSolo
    ? "Tienes 1.000 puntos posibles, repartidos según tus compromisos. Aquí verás cómo avanzas."
    : isPair
      ? "Cada uno tiene 1.000 puntos posibles, repartidos según sus compromisos. Aquí verás cómo avanzan los dos."
      : "Cada uno tiene 1.000 puntos posibles, repartidos según sus compromisos. Aquí verás cómo avanzan todos.";

  return (
    <div className={styles.container}>
      <SeasonHeader
        circle={circle}
        season={season}
        calendar={calendar}
        subtitle={`${shortDate(season.actualStart)} – ${shortDate(season.lastDay)} · día 1`}
      />

      <div className={`pj-card ${styles.heroCard}`}>
        <Illustration
          name="caminar"
          size="caminar"
          alt="Una mujer camina con una cinta de color a su alrededor"
        />
        <h2 className={styles.heroTitle}>La temporada empieza hoy.</h2>
        <p className={styles.heroBody}>{heroCopy}</p>
      </div>

      <Standings
        standings={standings}
        season={season}
        calendar={calendar}
        onNavigateToMember={onNavigateToMember}
        footer="Todavía nadie ha registrado."
      />

      {isSolo && (
        <SeasonCommitmentsList
          commitments={own.commitments}
          onNavigateToCommitment={onNavigateToCommitment}
        />
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
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alertRef.current?.focus();
  }, []);

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

      <div className={styles.errorCenter} role="alert" tabIndex={-1} ref={alertRef}>
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
      if (isNonRecoverableError(query.error)) {
        return <Navigate to="/" replace />;
      }
      return (
        <SeasonError
          circleName={circleName}
          lengthWeeks={lengthWeeks}
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

  const { data, isError, error, refetch } = myCircleQuery;

  if (data === undefined) {
    if (isError) {
      if (isNonRecoverableError(error)) {
        return <Navigate to="/" replace />;
      }
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
