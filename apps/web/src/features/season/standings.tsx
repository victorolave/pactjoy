import type { SeasonProgress } from "../../ports/wire.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import styles from "./Standings.module.css";

type StartedSeason = Extract<SeasonProgress, { state: "active" | "ended" }>;
export type SeasonStandingsRow = StartedSeason["standings"]["rows"][number];

export interface StandingsProps {
  readonly standings: {
    readonly memberCount: number;
    readonly rows: readonly SeasonStandingsRow[];
  };
  readonly season: { readonly lengthWeeks: number };
  readonly calendar: { readonly weekIndex: number; readonly daysLeft: number };
  readonly onNavigateToMember?: ((memberId: string) => void) | undefined;
}

/** Gap copy thresholds per Notion Mechanics & design 23a (pairs only). */
export function formatPairGapCopy(diff: number, lengthWeeks: number, weekIndex: number): string {
  if (diff === 0) return "Mismos puntos. La temporada sigue muy pareja.";
  if (diff <= 20) {
    return `${diff === 1 ? "1 pt" : `${diff} pts`} de diferencia. La temporada sigue muy pareja.`;
  }
  if (diff <= 80) {
    const left = lengthWeeks - (weekIndex + 1);
    if (left <= 0) {
      return `${diff} pts de diferencia.`;
    }
    return `${diff} pts de diferencia. Todavía ${left === 1 ? "queda 1 semana" : `quedan ${left} semanas`}.`;
  }
  return `${diff} pts de diferencia. Tu progreso también tiene su propio ritmo.`;
}

export function Standings({ standings, season, calendar, onNavigateToMember }: StandingsProps) {
  if (standings.memberCount <= 1) return null;

  const isPair = standings.memberCount === 2;
  const { rows } = standings;
  const first = rows[0];
  const second = rows[1];
  const gapText =
    isPair && first !== undefined && second !== undefined
      ? formatPairGapCopy(
          Math.abs(first.points - second.points),
          season.lengthWeeks,
          calendar.weekIndex,
        )
      : null;
  const peerRow = isPair ? (rows.find((r) => !r.isViewer) ?? null) : null;

  return (
    <div className={`pj-card ${styles.card}`}>
      <div className={styles.header}>
        <span className={styles.title}>Así va la temporada</span>
        <span className={styles.subtitle}>Puntos acumulados</span>
      </div>

      <ol className={styles.list}>
        {rows.map((row) => {
          const content = (
            <>
              <span className={styles.rank} aria-hidden={row.rank === null}>
                {row.rank}
              </span>
              <Avatar name={row.displayName} size={28} />
              <span className={styles.name}>{row.displayName}</span>
              <span className={styles.points}>{row.points} pts</span>
            </>
          );

          if (!isPair && !row.isViewer && onNavigateToMember) {
            const accessibleName =
              row.rank !== null
                ? `${row.rank}. ${row.displayName}, ${row.points} pts`
                : `${row.displayName}, ${row.points} pts`;
            const hintId = `hint-season-member-${row.memberId}`;

            return (
              <li key={row.memberId}>
                <button
                  type="button"
                  className={styles.rowInteractive}
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
            <li
              key={row.memberId}
              className={`${styles.row} ${row.isViewer ? styles.isViewer : ""}`}
            >
              {content}
            </li>
          );
        })}
      </ol>

      {gapText !== null && <div className={styles.gap}>{gapText}</div>}

      {isPair && peerRow !== null && (
        <div>
          <button
            type="button"
            className={styles.peerLink}
            onClick={() => onNavigateToMember?.(peerRow.memberId)}
          >
            Ver la temporada de {peerRow.displayName}
          </button>
        </div>
      )}
    </div>
  );
}
