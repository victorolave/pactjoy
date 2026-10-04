import { useState } from "react";
import { useNavigate } from "react-router";
import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { useNameDraft } from "../../onboarding/index.ts";
import { circleFailure } from "../circle-messages.ts";
import { useLeaveCircle } from "../queries.ts";
import styles from "./LeaveCircleSheet.module.css";
import { leaveCopy } from "./leave-copy.ts";

type Circle = NonNullable<MyCircle["circle"]>;

/** Where the user lands once out: Today, which shows the no-circle state. */
const AFTER_LEAVE_PATH = "/";

const ignore = () => {};

/**
 * Leaving the circle (design 40c, WC-R12). What it says depends on the season phase and on who
 * stays. The viewer's displayName is saved as the device's name draft BEFORE the request settles:
 * once they have no circle the onboarding gate sends anyone without a draft to the name step, and
 * the draft also prefills a rejoin. The mutation refetches Today and the circle before it resolves,
 * so the navigation never lands on the old state. While the request is in flight the sheet cannot be
 * dismissed (Cancelar, Escape or the scrim): closing would hide a leave that still goes through.
 */
export function LeaveCircleSheet({
  circle,
  season,
  open,
  onClose,
}: {
  readonly circle: Circle;
  readonly season: MyCircle["season"];
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const leave = useLeaveCircle(circle.id);
  const { saveDraft } = useNameDraft();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | undefined>();
  const { title, body } = leaveCopy(circle, season);
  const myName = circle.members.find((member) => member.isYou)?.displayName;

  const confirm = async () => {
    if (leave.isPending) return;
    setFailure(undefined);
    if (myName !== undefined) saveDraft(myName);
    try {
      await leave.mutateAsync();
      navigate(AFTER_LEAVE_PATH, { replace: true });
    } catch (error) {
      setFailure(circleFailure(error).message);
    }
  };

  return (
    <Sheet
      open={open}
      title={title}
      headless
      onClose={leave.isPending ? ignore : onClose}
      actions={
        <>
          <Button variant="secondary" block disabled={leave.isPending} onClick={confirm}>
            Salir del círculo
          </Button>
          <Button variant="ghost" block disabled={leave.isPending} onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        {failure !== undefined && <InlineMessage tone="error" title={failure} />}
      </div>
    </Sheet>
  );
}
