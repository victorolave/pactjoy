import type { ProfileSummaryDto } from "../../../ports/wire.ts";
import { Card } from "../../../ui/Card.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { HabitGlyph } from "../../habits/index.ts";
import { HabitStageTag } from "../../review/index.ts";
import { useProfileSummary } from "../queries.ts";
import styles from "./ProfileScreen.module.css";
import { HABITS_EMPTY, HABITS_ERROR, OUT_OF_SEASON_NOTE } from "./profile-sections.ts";

/**
 * "Tus hábitos" (design 39): the viewer's habits that are not graduated, each with the stage it
 * has reached. The graduated ones live only under "Hábitos graduados". Owner-only by construction.
 */
export function HabitsSection() {
  const query = useProfileSummary();
  const habits = query.data?.habits ?? [];
  return (
    <section className={styles.section} aria-busy={query.isLoading}>
      <h2 className={styles.sectionTitle}>Tus hábitos</h2>
      {query.isError ? (
        <p className={styles.note}>{HABITS_ERROR}</p>
      ) : query.isLoading ? (
        <Skeleton shape="line" />
      ) : habits.length === 0 ? (
        <p className={styles.note}>{HABITS_EMPTY}</p>
      ) : (
        <Card flush>
          <ul className={styles.list}>
            {habits.map((habit) => (
              <HabitRow key={habit.habitId} habit={habit} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function HabitRow({ habit }: { readonly habit: ProfileSummaryDto["habits"][number] }) {
  return (
    <li className={styles.row}>
      <HabitGlyph icon={habit.icon} />
      <span className={styles.rowInfo}>
        <span className={styles.rowTitle}>{habit.name}</span>
        {habit.inCurrentSeason ? null : <span className={styles.rowSub}>{OUT_OF_SEASON_NOTE}</span>}
      </span>
      <HabitStageTag stage={habit.stage} />
    </li>
  );
}
