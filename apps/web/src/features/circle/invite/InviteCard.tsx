import type { CircleInvite } from "../../../ports/pactjoy-api.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import styles from "./InviteCard.module.css";
import { expiryNote } from "./invite-text.ts";
import { useInvite } from "./use-invite.ts";

/**
 * Design 5: the code large, Copiar and Compartir, when it expires and "Nuevo código". An expired
 * code is replaced by a prompt to get a new one (WC-R2); a circle without any code (its first
 * invite failed) offers "Generar código".
 */
export function InviteCard({
  circleId,
  invite,
}: {
  readonly circleId: string;
  readonly invite: CircleInvite | null;
}) {
  const view = useInvite(circleId, invite);
  const { live } = view;
  return (
    <>
      <Card>
        <div className={styles.card}>
          <div className={styles.label}>Código del círculo</div>
          {live === null ? (
            <>
              <p className={styles.missing}>
                {view.expired ? "Este código ya caducó." : "Este círculo aún no tiene código."}
              </p>
              <Button block leadingIcon="refresh-cw" disabled={view.renewing} onClick={view.renew}>
                {view.expired ? "Nuevo código" : "Generar código"}
              </Button>
            </>
          ) : (
            <>
              <div className={styles.code}>{live.code}</div>
              <div className={styles.actions}>
                <Button variant="secondary" block leadingIcon="copy" onClick={view.copy}>
                  Copiar
                </Button>
                {view.canShare && (
                  <Button block leadingIcon="share" onClick={view.share}>
                    Compartir
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Card>
      {live !== null && (
        <div className={styles.expiry}>
          <p className={styles.note}>{expiryNote(live.expiresAt, view.nowMs)}</p>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="refresh-cw"
            disabled={view.renewing}
            onClick={view.renew}
          >
            Nuevo código
          </Button>
        </div>
      )}
      {view.failure !== undefined && <InlineMessage tone="error" title={view.failure} />}
    </>
  );
}
