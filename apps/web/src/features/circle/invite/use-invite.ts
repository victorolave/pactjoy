import { useEffect, useRef, useState } from "react";
import { useClock } from "../../../context/clock-context.tsx";
import { useSharing } from "../../../context/sharing-context.tsx";
import { useToasts } from "../../../context/toast-context.tsx";
import type { CircleInvite } from "../../../ports/pactjoy-api.ts";
import { circleFailure } from "../circle-messages.ts";
import { useGenerateInvite } from "../queries.ts";
import { inviteMessage, isExpired } from "./invite-text.ts";

/** setTimeout stores its delay in 32 bits; a longer one fires at once. */
const MAX_TIMEOUT_MS = 2_000_000_000;

/** Re-renders at the instant the invite expires, so an open screen flips to "Nuevo código" by itself. */
function useExpired(expiresAt: string | undefined): boolean {
  const clock = useClock();
  const [, tick] = useState(0);
  useEffect(() => {
    if (expiresAt === undefined) return;
    const left = Date.parse(expiresAt) - clock.nowMs();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(left, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [clock, expiresAt]);
  return expiresAt !== undefined && isExpired(expiresAt, clock.nowMs());
}

/**
 * What both invite views do (copy, share, replace the code) and when each applies. Clipboard and
 * share are called straight from the tap, never from an effect (WC-R2). Copying a code that is
 * already on screen works offline; replacing it does not (WC-R11).
 */
export function useInvite(circleId: string, invite: CircleInvite | null) {
  const sharing = useSharing();
  const toasts = useToasts();
  const clock = useClock();
  const regenerate = useGenerateInvite(circleId);
  const expired = useExpired(invite?.expiresAt);
  const [failure, setFailure] = useState<string | undefined>();
  // A ref, not `isPending`: two taps in one tick both see the same stale render.
  const renewing = useRef(false);

  const copy = async () => {
    if (invite === null) return;
    try {
      await sharing.copy(invite.code);
      toasts.show({ message: "Código copiado." });
    } catch {
      toasts.show({ message: "No pudimos copiar el código.", tone: "error" });
    }
  };

  const share = async () => {
    if (invite === null) return;
    try {
      await sharing.share({
        title: "PactJoy",
        text: inviteMessage(invite.code, invite.expiresAt),
      });
    } catch {
      toasts.show({ message: "No pudimos compartir el código.", tone: "error" });
    }
  };

  const renew = async () => {
    if (renewing.current || regenerate.isPending) return;
    renewing.current = true;
    setFailure(undefined);
    try {
      await regenerate.mutateAsync();
    } catch (error) {
      setFailure(circleFailure(error).message);
    } finally {
      renewing.current = false;
    }
  };

  return {
    /** The code can be used: there is one and it has not expired. */
    live: invite !== null && !expired ? invite : null,
    /** There was a code and it expired (as opposed to never having one). */
    expired: invite !== null && expired,
    canShare: sharing.canShare(),
    renewing: regenerate.isPending,
    failure,
    nowMs: clock.nowMs(),
    copy,
    share,
    renew,
  };
}
