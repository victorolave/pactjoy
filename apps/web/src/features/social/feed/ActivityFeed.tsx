import type { ReactNode } from "react";
import { useClock } from "../../../context/clock-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { NudgeCard } from "../nudge/NudgeCard.tsx";
import { useFeed, useReact } from "../queries.ts";
import { FeedItemRow } from "./FeedItemRow.tsx";
import styles from "./feed.module.css";
import { deviceDate, groupFeed } from "./feed-groups.ts";

/**
 * "Actividad del círculo" (design 31a/31b): the circle's feed in Hoy, Esta semana and Antes, with
 * the reaction chips on each item and "Cargar más" for the next page. Before the first season
 * starts there is nothing to show yet and it says so (31b).
 */
export function ActivityFeed() {
  const clock = useClock();
  const feed = useFeed();
  const react = useReact(feed.seasonId ?? "");
  const today = deviceDate(clock.nowMs());

  let body: ReactNode;
  if (feed.isPending) {
    body = (
      <div role="status" aria-label="Cargando la actividad">
        <Skeleton shape="card" lines={2} />
      </div>
    );
  } else if (feed.isError && feed.data === undefined) {
    body = (
      <InlineMessage
        tone="error"
        title="No pudimos cargar la actividad."
        action={
          <Button size="sm" variant="secondary" onClick={() => void feed.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  } else if (feed.seasonId === null || feed.items.length === 0) {
    body = (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Tu círculo empieza aquí.</p>
        <p className={styles.small}>La actividad aparecerá cuando empiece la temporada.</p>
      </div>
    );
  } else {
    body = (
      <>
        {feed.nudge !== null && <NudgeCard nudge={feed.nudge} members={feed.members} />}
        {groupFeed(feed.items, today).map((group) => (
          <div key={group.title} className={styles.group}>
            <h3 className={styles.groupTitle}>{group.title}</h3>
            <ul className={styles.list}>
              {group.items.map((item) => (
                <FeedItemRow
                  key={item.key}
                  item={item}
                  members={feed.members}
                  onReact={(itemKey, emoji) => react.mutate({ itemKey, emoji })}
                />
              ))}
            </ul>
          </div>
        ))}
        {feed.hasNextPage && (
          <div className={styles.more}>
            <Button
              variant="secondary"
              size="sm"
              disabled={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              Cargar más
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <section className={styles.section} aria-label="Actividad del círculo">
      <h2 className={styles.heading}>Actividad del círculo</h2>
      {body}
    </section>
  );
}
