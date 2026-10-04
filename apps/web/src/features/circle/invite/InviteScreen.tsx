import { Navigate, useNavigate } from "react-router";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useMyCircle } from "../queries.ts";
import { InviteCard } from "./InviteCard.tsx";
import styles from "./InviteScreen.module.css";

/** Where "Listo" goes: back to the circle. */
const CIRCLE_PATH = "/circle";

/**
 * Design 5, reached right after creating a circle and from the Circle tab's "Invitar". It reads
 * the circle itself, so it survives a reload; without a circle there is nothing to invite to.
 */
export function InviteScreen() {
  const navigate = useNavigate();
  const { data, isError, refetch } = useMyCircle();
  const circle = data?.circle;
  if (data !== undefined && circle === null) return <Navigate to={CIRCLE_PATH} replace />;
  return (
    <FlowScreen
      title="Invita a alguien"
      footer={
        <Button variant="secondary" block onClick={() => navigate(CIRCLE_PATH)}>
          Listo
        </Button>
      }
    >
      {circle === undefined || circle === null ? (
        isError ? (
          <InlineMessage
            tone="error"
            title="No pudimos cargar tu círculo."
            action={
              <Button variant="ghost" size="sm" onClick={() => void refetch()}>
                Reintentar
              </Button>
            }
          />
        ) : (
          <Skeleton shape="card" />
        )
      ) : (
        <>
          <p className={styles.lead}>
            Comparte este código. Quien lo use entrará en {circle.name}.
          </p>
          <InviteCard circleId={circle.id} invite={circle.invite} />
        </>
      )}
    </FlowScreen>
  );
}
