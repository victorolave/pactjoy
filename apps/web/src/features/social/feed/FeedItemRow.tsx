import { useClock } from "../../../context/clock-context.tsx";
import type { FeedItemDto, FeedMemberDto, ReactionCode } from "../../../ports/wire.ts";
import { Avatar } from "../../../ui/Avatar.tsx";
import { cx } from "../../../ui/cx.ts";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { ReactionChips } from "../reactions/ReactionChips.tsx";
import styles from "./feed.module.css";
import { feedLine } from "./feed-copy.ts";
import { feedTime } from "./feed-time.ts";

export interface FeedItemRowProps {
  readonly item: FeedItemDto;
  readonly members: readonly FeedMemberDto[];
  /**
   * Shows the reaction chips of an item that carries reactions. Omitted, the row is read-only (the
   * Today preview): reacting happens in the circle.
   */
  readonly onReact?: (itemKey: string, code: ReactionCode | null) => void;
  /** A reaction on this item is in flight: its chips wait. */
  readonly reactionPending?: boolean;
}

/**
 * One item of the activity feed (design 31a, Lote 0 §3.5): the person's avatar or, for a system
 * item, an icon; the Spanish line; and below it the reaction chips. It is an `<li>`: rows go
 * inside the list their group draws.
 */
export function FeedItemRow({ item, members, onReact, reactionPending }: FeedItemRowProps) {
  const line = feedLine(item, members);
  const when = feedTime(item, useClock().nowMs());
  return (
    <li className={cx("pj-activity", styles.row)}>
      {line.avatarName !== null ? (
        <Avatar name={line.avatarName} size="40" />
      ) : (
        line.icon !== null && (
          <span className={styles.systemIcon}>
            <Icon name={line.icon} />
          </span>
        )
      )}
      <div className={styles.rowBody}>
        <span className={cx("pj-activity__text", styles.text)}>{line.text}</span>
        <time className={styles.time} dateTime={when.dateTime}>
          {when.label}
        </time>
        {onReact !== undefined && "reactions" in item && (
          <ReactionChips
            reactions={item.reactions}
            onReact={(code) => onReact(item.key, code)}
            pending={reactionPending === true}
          />
        )}
      </div>
    </li>
  );
}
