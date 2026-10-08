import type { SeasonProgress } from "../../ports/wire.ts";
import styles from "./WeeklyChart.module.css";

type StartedSeason = Extract<SeasonProgress, { state: "active" | "ended" }>;

export interface SeasonWeeklyChartProps {
  readonly progress: SeasonProgress;
}

export function SeasonWeeklyChart({ progress }: SeasonWeeklyChartProps) {
  if (progress.state === "notStarted") {
    return null;
  }

  const { standings, weeks } = progress as StartedSeason;
  if (standings.memberCount !== 2 || weeks.length === 0) {
    return null;
  }

  const viewerRow = standings.rows.find((r) => r.isViewer);
  const peerRow = standings.rows.find((r) => !r.isViewer);
  if (viewerRow === undefined || peerRow === undefined) {
    return null;
  }

  const viewerId = viewerRow.memberId;
  const peerId = peerRow.memberId;
  const peerName = peerRow.displayName;

  // Active points across past and current weeks determine the scaling ceiling.
  const activePoints = weeks
    .filter((w) => w.timing === "past" || w.timing === "current")
    .flatMap((w) => w.members.map((m) => m.points ?? 0));
  const maxPoints = Math.max(100, ...activePoints);

  const isEnded = progress.state === "ended";

  // Current week clause for in-progress week (omitted if season ended).
  const currentWeek = isEnded ? undefined : weeks.find((w) => w.timing === "current");
  const currentClause =
    currentWeek !== undefined
      ? `Esta semana, en curso: tú +${
          currentWeek.members.find((m) => m.memberId === viewerId)?.points ?? 0
        } · ${peerName} +${currentWeek.members.find((m) => m.memberId === peerId)?.points ?? 0}.`
      : null;

  // Best week clause strictly among past weeks with points > 0.
  const pastWeeks = weeks.filter((w) => w.timing === "past" || isEnded);
  let bestWeek: { weekNumber: number; points: number } | null = null;
  for (const w of pastWeeks) {
    const pts = w.members.find((m) => m.memberId === viewerId)?.points ?? 0;
    if (pts > 0) {
      if (bestWeek === null || pts > bestWeek.points) {
        bestWeek = { weekNumber: w.weekIndex + 1, points: pts };
      }
    }
  }
  const bestClause =
    bestWeek !== null
      ? `Tu mejor semana fue la ${bestWeek.weekNumber} (+${bestWeek.points}).`
      : null;

  const footerText = [currentClause, bestClause].filter(Boolean).join(" ");

  return (
    <div className={`pj-card ${styles.card}`}>
      <div className={styles.header}>
        <span className={styles.title}>Puntos por semana</span>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatchViewer} aria-hidden="true" />
            Tú
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatchPeer} aria-hidden="true" />
            {peerName}
          </span>
        </div>
      </div>

      <div
        className={styles.chartGrid}
        style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}
        aria-hidden="true"
      >
        {weeks.map((w) => {
          if (w.timing === "future") {
            return <div key={w.weekIndex} className={styles.futureColumn} />;
          }

          const viewerPts = w.members.find((m) => m.memberId === viewerId)?.points ?? 0;
          const peerPts = w.members.find((m) => m.memberId === peerId)?.points ?? 0;
          const viewerHeight =
            maxPoints > 0
              ? Math.min(100, Math.max(0, Math.round((viewerPts / maxPoints) * 100)))
              : 0;
          const peerHeight =
            maxPoints > 0 ? Math.min(100, Math.max(0, Math.round((peerPts / maxPoints) * 100))) : 0;
          const isCurrent = !isEnded && w.timing === "current";

          return (
            <div key={w.weekIndex} className={styles.weekColumn}>
              <span
                className={`${styles.barViewer} ${isCurrent ? styles.barCurrent : ""}`}
                style={{ height: `${viewerHeight}%` }}
              />
              <span
                className={`${styles.barPeer} ${isCurrent ? styles.barCurrent : ""}`}
                style={{ height: `${peerHeight}%` }}
              />
            </div>
          );
        })}
      </div>

      <div
        className={styles.labelsGrid}
        style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}
        aria-hidden="true"
      >
        {weeks.map((w) => {
          const isCurrent = !isEnded && w.timing === "current";
          return (
            <span
              key={w.weekIndex}
              className={isCurrent ? styles.weekLabelCurrent : styles.weekLabel}
            >
              S{w.weekIndex + 1}
            </span>
          );
        })}
      </div>

      <table className={styles.visuallyHidden}>
        <caption>Puntos por semana</caption>
        <thead>
          <tr>
            <th scope="col">Semana</th>
            <th scope="col">Tú</th>
            <th scope="col">{peerName}</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const viewerPts = w.members.find((m) => m.memberId === viewerId)?.points;
            const peerPts = w.members.find((m) => m.memberId === peerId)?.points;
            return (
              <tr key={w.weekIndex}>
                <th scope="row">Semana {w.weekIndex + 1}</th>
                <td>{viewerPts !== null && viewerPts !== undefined ? `${viewerPts} pts` : "—"}</td>
                <td>{peerPts !== null && peerPts !== undefined ? `${peerPts} pts` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {footerText !== "" && <div className={styles.footer}>{footerText}</div>}
    </div>
  );
}
