import { useNavigate } from "react-router";
import { longDate } from "../../../shared/format.ts";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { useReviewOffer } from "../queries.ts";
import { weeksPhrase } from "../review-format.ts";

/**
 * The notice in Temporada (design 33 note: "aviso en Temporada"). It reads the same Today model as
 * the card, so it shows on the same days, the closing review included (Notion: it is reached from
 * the Today card and from this notice). The closing review is titled "Revisión de cierre" and has
 * no deadline of its own. The wording is not designed yet.
 */
export function ReviewNotice() {
  const { pendingReview, baselineOffer } = useReviewOffer();
  const navigate = useNavigate();
  if (baselineOffer !== null) {
    return (
      <InlineMessage
        tone="info"
        title="Puedes responder tu punto de partida"
        action={
          <Button size="sm" onClick={() => void navigate(`/review/${baselineOffer.seasonId}/0`)}>
            Responder
          </Button>
        }
      >
        Es opcional y solo tú verás tus respuestas.
      </InlineMessage>
    );
  }
  if (pendingReview === null) return null;
  const { seasonId, periodIndex, firstWeek, lastWeek, dueUntil } = pendingReview;
  const label =
    pendingReview.kind === "closing"
      ? "Revisión de cierre"
      : `Revisión de ${weeksPhrase({ first: firstWeek, last: lastWeek })}`;
  return (
    <InlineMessage
      tone="info"
      title="Tienes una revisión pendiente"
      action={
        <Button size="sm" onClick={() => void navigate(`/review/${seasonId}/${periodIndex}`)}>
          Hacer la revisión
        </Button>
      }
    >
      {dueUntil === null ? label : `${label} · hasta el ${longDate(dueUntil, false)}`}
    </InlineMessage>
  );
}
