import { useId } from "react";
import type { MemberProgress } from "../../ports/wire.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Card } from "../../ui/Card.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { HabitGlyph } from "../habits/index.ts";
import styles from "./MemberSeason.module.css";
import { commitmentSubtitle, hiddenSubtitle, pointsOfPossible } from "./member-labels.ts";

type StartedMemberProgress = Extract<MemberProgress, { state: "active" | "ended" }>;

const percentText = (value: number | null): string => (value === null ? "-" : `${value} %`);

export interface MemberSeasonProps {
  readonly view: StartedMemberProgress;
  readonly onBack: () => void;
}

/**
 * Another member's season, read-only (design 23d): their points, consistency and ideal over ALL
 * their commitments, then each commitment. A private one shows only its weight and points. No
 * per-commitment positions and no row-by-row comparison (Notion: Experiencia social).
 */
export function MemberSeason({ view, onBack }: MemberSeasonProps) {
  const nameId = useId();
  const listId = useId();
  const { member, calendar, season, commitments } = view;
  const hasPrivate = commitments.some((commitment) => commitment.kind === "hidden");
  const metrics = [
    { label: "Puntos", value: String(view.points) },
    { label: "Consistencia", value: percentText(view.consistency) },
    { label: "Ideal", value: percentText(view.idealCompletion) },
  ];

  return (
    <section className={styles.screen}>
      <div className={styles.back}>
        <IconButton icon="chevron-left" label="Volver a Temporada" onClick={onBack} />
      </div>
      <div className={styles.content}>
        <header className={styles.identity}>
          <Avatar name={member.displayName} size="md" />
          <div>
            <p className={styles.meta}>
              {`Semana ${calendar.weekIndex + 1} de ${season.lengthWeeks}`}
            </p>
            <h1 id={nameId} className={styles.name}>
              {member.displayName}
            </h1>
          </div>
        </header>

        <ul className={styles.metrics} aria-labelledby={nameId}>
          {metrics.map((metric) => (
            <li key={metric.label}>
              <Card>
                <span className={styles.metricLabel}>{metric.label}</span>
                <span className={styles.metricValue}>{metric.value}</span>
              </Card>
            </li>
          ))}
        </ul>

        <div className={styles.group}>
          <div className={styles.groupHeader}>
            <h2 id={listId} className={styles.groupTitle}>
              Sus compromisos
            </h2>
            <span className={styles.small}>Puntos / posibles</span>
          </div>
          <Card flush>
            <ul className={styles.rows} aria-labelledby={listId}>
              {commitments.map((commitment) =>
                commitment.kind === "hidden" ? (
                  <li key={commitment.commitmentId} className={styles.row}>
                    <HabitGlyph icon={null} hidden />
                    <div className={styles.rowBody}>
                      <p className={styles.rowTitle}>Objetivo privado</p>
                      <p className={styles.small}>{hiddenSubtitle(commitment.weightPercent)}</p>
                    </div>
                    <span className={styles.rowPoints}>
                      {pointsOfPossible(commitment.points, commitment.weightPercent)}
                    </span>
                  </li>
                ) : (
                  <li key={commitment.commitmentId} className={styles.row}>
                    <HabitGlyph icon={commitment.habit.icon} />
                    <div className={styles.rowBody}>
                      <p className={styles.rowTitle}>{commitment.habit.name}</p>
                      <p className={styles.small}>
                        {commitmentSubtitle(commitment.measure, commitment.opportunities)}
                      </p>
                    </div>
                    <span className={styles.rowPoints}>
                      {pointsOfPossible(commitment.points, commitment.weightPercent)}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </Card>
        </div>

        {hasPrivate && (
          <p className={styles.small}>Los objetivos privados solo muestran su peso y sus puntos.</p>
        )}
      </div>
    </section>
  );
}
