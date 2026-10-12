import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { pauseFailure } from "../pause-messages.ts";
import { useResumePause } from "../queries.ts";

export interface ResumeSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pauseRequestId: string;
  /** The Commitment to resume; omitted resumes every one of the request still running (PL-33). */
  readonly commitmentId?: string | undefined;
  /** What the sheet calls the Commitment (or "tus compromisos"). */
  readonly subject: string;
  /** The pause is approved but has not started: resuming it cancels it (Q6, PS-12). */
  readonly startsLater?: boolean;
}

/**
 * Screen 29: "¿Reanudar <Commitment>?". Resuming needs no approval; the Commitment counts again from
 * today and the partial week is prorated by the days it was active, as scoring does. A pause that has
 * not started is labelled as the cancel it is.
 */
export function ResumeSheet({
  open,
  onClose,
  pauseRequestId,
  commitmentId,
  subject,
  startsLater = false,
}: ResumeSheetProps) {
  const online = useOnline();
  const resume = useResumePause();
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = async () => {
    if (resume.isPending) return;
    setFailure(null);
    try {
      await resume.mutateAsync({
        id: pauseRequestId,
        ...(commitmentId === undefined ? {} : { commitmentId }),
      });
      onClose();
    } catch (error) {
      setFailure(pauseFailure(error).message);
    }
  };

  return (
    <Sheet
      open={open}
      placement="center"
      title={startsLater ? `¿Cancelar la pausa de ${subject}?` : `¿Reanudar ${subject}?`}
      onClose={resume.isPending ? () => {} : onClose}
      actions={
        <>
          <Button block disabled={resume.isPending || !online} onClick={confirm}>
            {startsLater ? "Cancelar pausa" : "Reanudar hoy"}
          </Button>
          <Button variant="ghost" block disabled={resume.isPending} onClick={onClose}>
            {startsLater ? "Mantener pausa" : "Seguir en pausa"}
          </Button>
        </>
      }
    >
      <p>
        {startsLater
          ? "Todavía no empezó: se cancela y recuperas esos días de pausa. No necesitas aprobación."
          : "Vuelve a contar desde hoy y esta semana se prorratea por los días que estuvo activo. No necesitas aprobación."}
      </p>
      {failure !== null && <InlineMessage tone="error" title={failure} />}
    </Sheet>
  );
}
