import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { pauseFailure } from "../pause-messages.ts";
import { useCancelPauseRequest } from "../queries.ts";

/**
 * "¿Cancelar la solicitud?": the confirmation shared by the pending card and the on-hold Today row.
 * Cancelling counts like a rejection (Q2): the days count again and the window for what was on hold
 * stays open until the end of tomorrow. A "Todos" request is cancelled as a whole.
 */
export function CancelPauseSheet({
  pauseRequestId,
  open,
  onClose,
}: {
  readonly pauseRequestId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const online = useOnline();
  const cancel = useCancelPauseRequest();
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = async () => {
    if (cancel.isPending) return;
    setFailure(null);
    try {
      await cancel.mutateAsync(pauseRequestId);
      onClose();
    } catch (error) {
      setFailure(pauseFailure(error).message);
    }
  };

  return (
    <Sheet
      open={open}
      placement="center"
      title="¿Cancelar la solicitud?"
      onClose={cancel.isPending ? () => {} : onClose}
      actions={
        <>
          <Button block disabled={cancel.isPending || !online} onClick={confirm}>
            Sí, cancelar
          </Button>
          <Button variant="ghost" block disabled={cancel.isPending} onClick={onClose}>
            Mantener solicitud
          </Button>
        </>
      }
    >
      <p>
        Esos días vuelven a contar y tendrás hasta el final de mañana para registrar lo que quedó en
        espera.
      </p>
      {failure !== null && <InlineMessage tone="error" title={failure} />}
    </Sheet>
  );
}
