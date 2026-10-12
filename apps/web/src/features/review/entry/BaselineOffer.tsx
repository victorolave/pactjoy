import { useNavigate } from "react-router";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { useReviewOffer, useSkipBaseline } from "../queries.ts";
import styles from "../review.module.css";

/**
 * The optional first SRBAI (screen 13), offered from the pact close through season day 7. "Ahora
 * no" is stored, so the offer stops for good; without a baseline there is simply no "de X a Y" at
 * the end of later reviews. The wording of this card is not designed yet.
 */
export function BaselineOffer() {
  const { baselineOffer } = useReviewOffer();
  const navigate = useNavigate();
  const online = useOnline();
  const skip = useSkipBaseline(baselineOffer?.seasonId ?? "");
  if (baselineOffer === null) return null;
  return (
    <Card>
      <div className={styles.offer}>
        <h2 className={styles.offerTitle}>Tu punto de partida</h2>
        <p className={styles.small}>
          Cuéntanos cuánto se siente automático cada hábito hoy. Solo tú verás tus respuestas.
        </p>
        {skip.isError && (
          <InlineMessage tone="error">No pudimos guardarlo. Revisa tu conexión.</InlineMessage>
        )}
        <div className={styles.offerActions}>
          <Button onClick={() => void navigate(`/review/${baselineOffer.seasonId}/0`)}>
            Responder
          </Button>
          <Button
            variant="ghost"
            disabled={!online || skip.isPending}
            onClick={() => skip.mutate()}
          >
            Ahora no
          </Button>
        </div>
      </div>
    </Card>
  );
}
