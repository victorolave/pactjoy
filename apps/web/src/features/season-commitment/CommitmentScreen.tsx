import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { ApiError } from "../../ports/api-error.ts";
import type { CommitmentProgress } from "../../ports/wire.ts";
import { formatDecimal, unitLabel } from "../../shared/row-labels.ts";
import { progressRoutes } from "../../shared/season-progress-routes.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { ProgressBar } from "../../ui/ProgressBar.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { useCommitmentProgress } from "../season-progress-data/index.ts";
import styles from "./CommitmentScreen.module.css";
import {
  commitmentSubtitle,
  opportunitiesText,
  perOpportunityText,
  streakCount,
  streakRule,
} from "./commitment-labels.ts";
import { HistoryGrid } from "./HistoryGrid.tsx";

type Started = Extract<CommitmentProgress, { state: "active" | "ended" }>;

/** Statuses meaning there is no such commitment for the viewer: the overview, not an error. */
const NOT_VIEWABLE = new Set([400, 403, 404]);

const percentText = (value: number | null) => (value === null ? "—" : `${value} %`);

function Frame(props: {
  readonly back: { readonly label: string; readonly to: string };
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <section className={styles.screen}>
      <div className={styles.back}>
        <IconButton
          icon="chevron-left"
          label={props.back.label}
          onClick={() => navigate(props.back.to)}
        />
      </div>
      <div className={styles.content}>{props.children}</div>
    </section>
  );
}

function PointsCard({ view }: { readonly view: Started }) {
  const row = view.commitment;
  const opportunities = opportunitiesText(row.opportunities);
  const bar = (
    <ProgressBar
      label="Puntos"
      value={row.points}
      max={row.weightPercent * 10}
      valueLabel={`${row.points} de ${row.weightPercent * 10} pts`}
    />
  );
  if (row.measure.unit === "done") {
    return (
      <div className={`pj-card ${styles.card}`}>
        {bar}
        <p className={styles.small}>
          <b>{`Consistencia ${percentText(row.consistency)}`}</b>
          {opportunities !== null && ` · ${opportunities}`}
        </p>
        <p className={styles.muted}>En hecho / no hecho, consistencia e ideal coinciden.</p>
      </div>
    );
  }
  const current = view.weeks.find((week) => week.timing === "current") ?? null;
  const streak = streakCount(row.streak);
  return (
    <div className={`pj-card ${styles.card}`}>
      {bar}
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span className={styles.meta}>Consistencia</span>
          <span className={styles.stat}>{percentText(row.consistency)}</span>
          {opportunities !== null && <span className={styles.meta}>{opportunities}</span>}
        </div>
        <div className={styles.tile}>
          <span className={styles.meta}>Ideal</span>
          <span className={styles.stat}>{percentText(row.idealCompletion)}</span>
          <span className={styles.meta}>del ideal completado</span>
        </div>
      </div>
      <div className={styles.streak}>
        <span>
          Racha actual <b>{streak.current}</b>
        </span>
        <span>
          Mejor racha <b>{streak.best}</b>
        </span>
      </div>
      <p className={styles.muted}>{streakRule(row, current)}</p>
    </div>
  );
}

function Scoring({ view }: { readonly view: Started }) {
  const { curve, perOpportunityPoints } = view.scoring;
  const { measure } = view.commitment;
  if (curve === null || measure.unit === "done") return null;
  const unit = unitLabel(measure);
  const worth = perOpportunityText(perOpportunityPoints);
  const sample = (value: string) =>
    unit ? `${formatDecimal(value)} ${unit}` : formatDecimal(value);
  return (
    <div className={`pj-card ${styles.card}`}>
      <span className={styles.label}>Cómo puntúa</span>
      {/* Screen readers get each value paired with its progress, like the wizard's preview. */}
      <ul className={styles.visuallyHidden}>
        {curve.map((point) => (
          <li key={point.value}>{`${sample(point.value)}: ${point.progressPercent} %`}</li>
        ))}
      </ul>
      <div
        className={styles.curve}
        style={{ gridTemplateColumns: `repeat(${curve.length}, 1fr)` }}
        aria-hidden="true"
      >
        {curve.map((point, index) => (
          <span key={point.value} className={styles.meta}>
            {index === 0 ? sample(point.value) : formatDecimal(point.value)}
          </span>
        ))}
        {curve.map((point) => (
          <b key={point.value} className={styles.curveValue}>{`${point.progressPercent} %`}</b>
        ))}
      </div>
      {worth !== null && <p className={styles.muted}>{worth}</p>}
    </div>
  );
}

function Commitment({ view }: { readonly view: Started }) {
  const row = view.commitment;
  return (
    <>
      <div className={styles.header}>
        <div className={styles.badges}>
          {row.privacy === "visible" ? (
            <Badge icon="eye">Visible para el círculo</Badge>
          ) : (
            <Badge icon="eye-off">Privado</Badge>
          )}
          {row.pause !== "none" && (
            <Badge tone="pending" icon="circle-pause">
              {row.pause === "onHold" ? "En espera" : "En pausa"}
            </Badge>
          )}
        </div>
        <h1 className={styles.title}>{row.habit.name}</h1>
        <p className={styles.subtitle}>{commitmentSubtitle(row)}</p>
      </div>
      <PointsCard view={view} />
      <HistoryGrid view={view} />
      <Scoring view={view} />
    </>
  );
}

/**
 * `/season/:seasonId/commitments/:commitmentId` (design 24a, 24b): one commitment's season,
 * read-only. Stage, reminder and pause actions are not part of Lote 2. Back honours where it was
 * opened from (Today passes `{ from: "today" }`), Temporada otherwise.
 */
export function CommitmentScreen() {
  const { seasonId = "", commitmentId = "" } = useParams();
  const state: unknown = useLocation().state;
  const fromToday =
    typeof state === "object" && state !== null && "from" in state && state.from === "today";
  const back = fromToday
    ? { label: "Volver", to: "/" }
    : { label: "Volver a Temporada", to: progressRoutes.overview };
  const query = useCommitmentProgress(seasonId, commitmentId);

  if (query.isPending) {
    return (
      <Frame back={back}>
        <div aria-busy="true">
          <Skeleton shape="line" lines={2} />
          <Skeleton shape="card" lines={2} />
        </div>
      </Frame>
    );
  }
  if (query.isError) {
    if (query.error instanceof ApiError && NOT_VIEWABLE.has(query.error.status)) {
      return <Navigate to={progressRoutes.overview} replace />;
    }
    return (
      <Frame back={back}>
        <div className={styles.failure} role="alert">
          <span className={styles.failureIcon}>
            <Icon name="cloud-off" size="lg" />
          </span>
          <p className={styles.failureTitle}>No pudimos cargar la temporada.</p>
          <p className={styles.muted}>Tus registros están a salvo. Inténtalo de nuevo.</p>
          <Button leadingIcon="rotate-cw" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </div>
      </Frame>
    );
  }
  if (query.data.state === "notStarted") {
    return <Navigate to={progressRoutes.overview} replace />;
  }
  return (
    <Frame back={back}>
      <Commitment view={query.data} />
    </Frame>
  );
}
