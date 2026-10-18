import { useEffect, useRef, useState } from "react";
import { useDeviceStore } from "../../../context/device-store-context.tsx";
import { memberName } from "../../../shared/member-name.ts";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { commitmentList, peersUnchangedText, perOpportunityText } from "../pause-format.ts";
import { useCircleForPause, useMyPauseRequests } from "../queries.ts";

interface Shown {
  readonly key: string;
  readonly text: string;
}

function totalText(before: number, after: number): string {
  if (after === before) return `Tu total se mantiene en ${after}.`;
  return `Tu total ${after > before ? "subió" : "bajó"} de ${before} a ${after}.`;
}

/**
 * Screen 30b: "Los puntos se recalcularon", shown ONCE per approved request on this device
 * (PS-14, PS-15). The server recomputes the comparison on every read, so "once" is the device flag
 * `pause-redistributed-seen:<requestId>`: it is written when the notice is first shown, and the
 * notice stays up while the screen is open. Clearing the flag, or another device, shows it again.
 * The wording for "Todos" is generic (owner default, #5903): it lists the Commitments. A single
 * Commitment says what each remaining opportunity is worth now, and the notice ends with whose points
 * did not change. The peers come from the circle read, so the text waits for it: an error just omits them.
 */
export function RedistributedBanner() {
  const device = useDeviceStore();
  const { data } = useMyPauseRequests();
  const circle = useCircleForPause();
  const [shown, setShown] = useState<Shown | null>(null);
  const decided = useRef<string | null>(null);
  const redistributed = data?.redistributed ?? null;

  useEffect(() => {
    if (data === undefined || redistributed === null || circle.isPending) return;
    if (decided.current === redistributed.pauseRequestId) return;
    decided.current = redistributed.pauseRequestId;

    const changed =
      redistributed.total.before !== redistributed.total.after ||
      redistributed.commitments.some((c) => c.before !== c.after);
    const key = `pause-redistributed-seen:${redistributed.pauseRequestId}` as const;
    if (!changed || device.get(key) !== null) return;

    const request = data.mine.find((r) => r.id === redistributed.pauseRequestId);
    const names = request?.commitments.map((c) => c.habitName) ?? [];
    const only = redistributed.commitments.length === 1 ? redistributed.commitments[0] : undefined;
    const { before, after } = redistributed.total;
    const lead =
      only !== undefined && names.length === 1
        ? only.opportunities.after > 0
          ? perOpportunityText(names[0] ?? "", only.weightPoints, only.opportunities.after)
          : `Al pausar ${names[0]}, sus puntos pasaron de ${only.before} a ${only.after}.`
        : `Tu pausa cubre ${names.length === 0 ? "tus compromisos" : commitmentList(names)}: sus puntos se redistribuyeron entre las oportunidades que siguen activas.`;
    const peers = peersUnchangedText(
      (circle.data?.circle?.members ?? [])
        .filter((m) => !m.isYou)
        .map((m) => memberName(m.displayName)),
    );
    const text = [lead, totalText(before, after), peers].filter(Boolean).join(" ");
    device.set(key, "1");
    setShown({ key, text });
  }, [data, redistributed, device, circle.isPending, circle.data]);

  if (shown === null) return null;
  return (
    <InlineMessage
      tone="info"
      title="Los puntos se recalcularon"
      action={
        <Button size="sm" variant="secondary" onClick={() => setShown(null)}>
          Entendido
        </Button>
      }
    >
      {shown.text}
    </InlineMessage>
  );
}
