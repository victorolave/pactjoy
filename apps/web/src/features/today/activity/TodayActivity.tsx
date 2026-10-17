import { ButtonLink } from "../../../ui/ButtonLink.tsx";
import { FeedItemRow, useFeed } from "../../social/index.ts";
import styles from "./activity.module.css";

/** How many items Today previews; the rest is one tap away in the Circle tab. */
const PREVIEW_ITEMS = 3;

/**
 * The circle's latest activity under the viewer's own opportunities (ADR-0018): the first three
 * items, read-only, and the way to the full feed. It shows nothing while loading, when the feed is
 * empty or when it cannot be read: Today never waits for, or fails because of, the social layer.
 * Reacting is a Circle tab action, so there are no chips here.
 */
export function TodayActivity() {
  const feed = useFeed();
  const items = feed.items.slice(0, PREVIEW_ITEMS);
  if (items.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Actividad del círculo">
      <h2 className={styles.title}>Actividad del círculo</h2>
      <ul className={styles.list}>
        {items.map((item) => (
          <FeedItemRow key={item.key} item={item} members={feed.members} />
        ))}
      </ul>
      <div className={styles.link}>
        <ButtonLink to="/circle" variant="ghost" size="sm">
          Ver actividad del círculo
        </ButtonLink>
      </div>
    </section>
  );
}
