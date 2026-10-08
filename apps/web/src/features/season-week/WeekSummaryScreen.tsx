import { type ReactNode, useId } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { ApiError } from "../../ports/api-error.ts";
import type { WeekSummary } from "../../ports/wire.ts";
import { progressRoutes } from "../../shared/season-progress-routes.ts";
import { AvatarStack } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Card } from "../../ui/Card.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { useWeekSummary } from "../season-progress-data/index.ts";
import styles from "./WeekSummary.module.css";
import { breakdownText, circleLine, headlineText, weekMeta, weeksLeftText } from "./week-labels.ts";

/** Statuses meaning there is no such week summary for the viewer: the overview, not an error. */
const NOT_VIEWABLE = new Set([400, 403, 404]);
const TODAY = "/";

const percentText = (value: number | null) => (value === null ? "—" : `${value} %`);

/** The full-screen frame of 25b: Cerrar at the top right, the content, then the way back. */
function Frame({
  children,
  onClose,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.close}>
        <IconButton icon="x" label="Cerrar" onClick={onClose} />
      </div>
      <div className={styles.content}>{children}</div>
    </main>
  );
}

function Summary({
  summary,
  onDone,
}: {
  readonly summary: WeekSummary;
  readonly onDone: () => void;
}) {
  const headingId = useId();
  const headline = headlineText(summary.headline);
  const weeksLeft = summary.headline === "difficult" ? weeksLeftText(summary.weeksLeft) : null;
  const circle = circleLine(summary);
  const metrics = [
    { label: "Puntos", value: `+${summary.points}` },
    { label: "Consistencia", value: percentText(summary.consistency) },
    { label: "Ideal", value: percentText(summary.idealCompletion) },
  ];
  return (
    <>
      {headline === null ? (
        <h1 id={headingId} className={styles.meta}>
          {weekMeta(summary)}
        </h1>
      ) : (
        <div>
          <p className={styles.meta}>{weekMeta(summary)}</p>
          <h1 id={headingId} className={styles.headline}>
            {headline}
          </h1>
          {weeksLeft !== null && <p className={styles.lead}>{weeksLeft}</p>}
        </div>
      )}
      <ul className={styles.metrics} aria-labelledby={headingId}>
        {metrics.map((metric) => (
          <li key={metric.label}>
            <Card>
              <span className={styles.metricLabel}>{metric.label}</span>
              <span className={styles.metricValue}>{metric.value}</span>
            </Card>
          </li>
        ))}
      </ul>
      <Card flush>
        <ul className={styles.rows}>
          {summary.commitments.map((row) => (
            <li key={row.commitmentId} className={styles.row}>
              <b>{row.habit.name}</b>
              <span>{breakdownText(row)}</span>
            </li>
          ))}
        </ul>
      </Card>
      {circle !== null && summary.circle !== null && (
        <Card tone="sunken">
          <div className={styles.circle}>
            <AvatarStack names={summary.circle.map((member) => member.displayName)} size={28} />
            <p className={styles.circleText}>{circle}</p>
          </div>
        </Card>
      )}
      <div className={styles.footer}>
        <Button block onClick={onDone}>
          Seguir con mi día
        </Button>
      </div>
    </>
  );
}

/**
 * `/season/:seasonId/weeks/:weekIndex/summary` (design 25b, 25c): the viewer's own week, recomputed
 * live by the server (it changes while the week's grace is open). Cerrar and "Seguir con mi día"
 * return to Today; it can be reopened from Temporada.
 */
export function WeekSummaryScreen() {
  const { seasonId = "", weekIndex: rawWeek = "" } = useParams();
  const weekIndex = /^\d+$/.test(rawWeek) ? Number(rawWeek) : null;
  if (weekIndex === null) return <Navigate to={progressRoutes.overview} replace />;
  return <LoadedWeek seasonId={seasonId} weekIndex={weekIndex} />;
}

function LoadedWeek({
  seasonId,
  weekIndex,
}: {
  readonly seasonId: string;
  readonly weekIndex: number;
}) {
  const navigate = useNavigate();
  const query = useWeekSummary(seasonId, weekIndex);
  const toToday = () => navigate(TODAY);

  if (query.isPending) {
    return (
      <Frame onClose={toToday}>
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
      <Frame onClose={toToday}>
        <div className={styles.failure} role="alert">
          <span className={styles.failureIcon}>
            <Icon name="cloud-off" size="lg" />
          </span>
          <p className={styles.failureTitle}>No pudimos cargar la temporada.</p>
          <p className={styles.lead}>Tus registros están a salvo. Inténtalo de nuevo.</p>
          <Button leadingIcon="rotate-cw" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </div>
      </Frame>
    );
  }
  return (
    <Frame onClose={toToday}>
      <Summary summary={query.data} onDone={toToday} />
    </Frame>
  );
}
