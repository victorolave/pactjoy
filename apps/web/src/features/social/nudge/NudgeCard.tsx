import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { ApiError } from "../../../ports/api-error.ts";
import type { FeedMemberDto, NudgeDto, ReactionCode } from "../../../ports/wire.ts";
import { isLeftMember } from "../../../shared/member-name.ts";
import { Card } from "../../../ui/Card.tsx";
import { cx } from "../../../ui/cx.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { subjectsText } from "../feed/feed-copy.ts";
import { useDismissNudge, useSendEncouragement } from "../queries.ts";
import { REACTIONS } from "../reactions/reaction-emojis.ts";
import styles from "./nudge.module.css";

/** The server already answered this case (sent, dismissed or no longer live): the card has nothing to offer. */
const STALE = new Set(["EncouragementAlreadySent", "NudgeNotAvailable"]);

export interface NudgeCardProps {
  readonly nudge: NudgeDto;
  /** To name the person; a member the circle does not list shows no card. */
  readonly members: readonly FeedMemberDto[];
}

/**
 * The encouragement nudge (design 31a): a warm card that says a member is having a harder time with
 * a habit and offers to send them a 🙌, ❤️, 🔥 or 👏. It is a suggestion, never a request: "Ahora
 * no" puts it away for this case. The word is the product's tone: it says who needs a hand, not
 * what they failed. After a send or a dismissal the card disappears.
 */
export function NudgeCard({ nudge, members }: NudgeCardProps) {
  const online = useOnline();
  const send = useSendEncouragement(nudge.seasonId);
  const dismiss = useDismissNudge(nudge.seasonId);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = members.find((member) => member.id === nudge.targetId);
  // Nobody to encourage once the member left or their account was deleted (no name to show).
  if (
    gone ||
    target === undefined ||
    target.displayName === null ||
    isLeftMember(target.displayName)
  )
    return null;

  const busy = send.isPending || dismiss.isPending;
  const settle = {
    onSuccess: () => setGone(true),
    onError: (error: unknown) => {
      if (error instanceof ApiError && STALE.has(error.code)) setGone(true);
      else setFailed(true);
    },
  };
  const sendEmoji = (emoji: ReactionCode) => {
    setFailed(false);
    send.mutate({ recipientId: nudge.targetId, week: nudge.week, emoji }, settle);
  };
  const putAway = () => {
    setFailed(false);
    dismiss.mutate({ targetId: nudge.targetId, week: nudge.week }, settle);
  };

  return (
    <Card tone="warm" role="group" aria-label="Sugerencia de ánimo">
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.copy}>
            <p className={styles.title}>
              {`A ${target.displayName} le está costando más ${subjectsText([nudge.subject])} estas semanas.`}
            </p>
            <p className={styles.ask}>¿Quieres enviarle ánimo?</p>
          </div>
          <IconButton icon="x" label="Ahora no" disabled={!online || busy} onClick={putAway} />
        </div>
        <div className={styles.emojis}>
          {REACTIONS.map(({ code, glyph, label }) => (
            <button
              key={code}
              type="button"
              className={cx("pj-tag", styles.emoji)}
              aria-label={`Enviar ${label}`}
              disabled={!online || busy}
              onClick={() => sendEmoji(code)}
            >
              <span aria-hidden="true">{glyph}</span>
            </button>
          ))}
        </div>
        {!online && (
          <p className={styles.offline}>Sin conexión: vuelve a conectarte para enviar ánimo.</p>
        )}
        {failed && (
          <InlineMessage tone="error" title="No pudimos enviar el ánimo. Inténtalo de nuevo." />
        )}
      </div>
    </Card>
  );
}
