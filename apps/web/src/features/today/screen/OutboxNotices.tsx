import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { noticeLine, noticeTitle, useOutbox, useOutboxState } from "../../entry/index.ts";
import styles from "./TodayScreen.module.css";

/**
 * Entries sent after a wait that the server turned down (OE-R10): one calm card with each habit, day
 * and reason. They stay, even after a reload, until the member says "Entendido".
 */
export function OutboxNotices() {
  const { notices } = useOutboxState();
  const outbox = useOutbox();
  if (notices.length === 0 || outbox === null) return null;
  return (
    <InlineMessage
      tone="info"
      title={noticeTitle(notices.length)}
      action={
        <Button size="sm" variant="secondary" onClick={() => outbox.dismissNotices()}>
          Entendido
        </Button>
      }
    >
      <span className={styles.noticeLines}>
        {notices.map((notice) => (
          <span key={notice.id}>{noticeLine(notice)}</span>
        ))}
      </span>
    </InlineMessage>
  );
}
