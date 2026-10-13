import { Link } from "react-router";
import type { HabitDto, SeasonHistoryItemDto } from "../../../ports/wire.ts";
import { dayMonth } from "../../../shared/format.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Card } from "../../../ui/Card.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useMyHabits, useSeasonHistory } from "../queries.ts";
import { ConsistencySection } from "./ConsistencySection.tsx";
import { HabitsSection } from "./HabitsSection.tsx";
import styles from "./ProfileScreen.module.css";
import { graduatedHabits, seasonRowSubtitle, seasonRowTitle } from "./profile-sections.ts";

/**
 * The design's sections (39), in its order: the consistency card, "Tus hábitos" (profile-habits-
 * consistency), "Temporadas" and "Hábitos graduados" (season-close-graduation). Only the viewer's
 * own data is read, and a failure in one section never blanks the others.
 */
export function ProfileSections() {
  return (
    <>
      <ConsistencySection />
      <HabitsSection />
      <SeasonHistory />
      <GraduatedHabits />
    </>
  );
}

function SeasonHistory() {
  const query = useSeasonHistory();
  const seasons = query.data?.seasons ?? [];
  return (
    <section className={styles.section} aria-busy={query.isLoading}>
      <h2 className={styles.sectionTitle}>Temporadas</h2>
      {query.isError ? (
        <p className={styles.note}>No pudimos cargar tus temporadas.</p>
      ) : query.isLoading ? (
        <Skeleton shape="line" />
      ) : seasons.length === 0 ? (
        <p className={styles.note}>Aún no hay temporadas. Las que cierres aparecerán aquí.</p>
      ) : (
        <Card flush>
          <ul className={styles.list}>
            {seasons.map((season) => (
              <SeasonRow key={season.seasonId} season={season} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function SeasonRow({ season }: { readonly season: SeasonHistoryItemDto }) {
  return (
    <li>
      <Link to={`/season/${season.seasonId}/results`} className={styles.row}>
        <span className={styles.rowInfo}>
          <span className={styles.rowTitle}>{seasonRowTitle(season)}</span>
          <span className={styles.rowSub}>{seasonRowSubtitle(season)}</span>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="chevron-right" size="sm" />
        </span>
      </Link>
    </li>
  );
}

function GraduatedHabits() {
  const query = useMyHabits();
  const habits = graduatedHabits(query.data ?? []);
  return (
    <section className={styles.section} aria-busy={query.isLoading}>
      <h2 className={styles.sectionTitle}>Hábitos graduados</h2>
      {query.isError ? (
        <p className={styles.note}>No pudimos cargar tus hábitos graduados.</p>
      ) : query.isLoading ? (
        <Skeleton shape="line" />
      ) : habits.length === 0 ? (
        <p className={styles.note}>
          Aún ninguno. Graduar es decisión tuya, al cerrar una temporada.
        </p>
      ) : (
        <Card flush>
          <ul className={styles.list}>
            {habits.map((habit) => (
              <GraduatedRow key={habit.id} habit={habit} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function GraduatedRow({ habit }: { readonly habit: HabitDto & { readonly graduatedAt: string } }) {
  return (
    <li className={styles.row}>
      <span className={styles.rowInfo}>
        <span className={styles.rowTitle}>{habit.name}</span>
        <span className={styles.rowSub}>
          Graduado el {dayMonth(habit.graduatedAt.slice(0, 10))}
        </span>
      </span>
      <Badge tone="info">🎓 Graduado</Badge>
    </li>
  );
}
