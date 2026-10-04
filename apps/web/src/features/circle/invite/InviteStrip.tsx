import type { CircleInvite } from "../../../ports/pactjoy-api.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import styles from "./InviteStrip.module.css";
import { expiryLabel } from "./invite-text.ts";
import { useInvite } from "./use-invite.ts";

/** The compact code row of the waiting room (design 7): code, expiry, and copy / share icons. */
export function InviteStrip({
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
        <div className={styles.row}>
          {live === null ? (
            <>
              <div className={styles.text}>
                <div className={styles.label}>
                  {view.expired ? "Este código ya caducó." : "Aún no hay código."}
                </div>
              </div>
              <Button
                size="sm"
                leadingIcon="refresh-cw"
                disabled={view.renewing}
                onClick={view.renew}
              >
                {view.expired ? "Nuevo código" : "Generar código"}
              </Button>
            </>
          ) : (
            <>
              <div className={styles.text}>
                <div className={styles.label}>{expiryLabel(live.expiresAt)}</div>
                <div className={styles.code}>{live.code}</div>
              </div>
              <IconButton icon="copy" label="Copiar código" onClick={view.copy} />
              {view.canShare && (
                <IconButton icon="share" label="Compartir código" onClick={view.share} />
              )}
            </>
          )}
        </div>
      </Card>
      {view.failure !== undefined && <InlineMessage tone="error" title={view.failure} />}
    </>
  );
}
