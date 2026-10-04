import { useNavigate } from "react-router";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { OfflineBanner } from "../../../platform/offline/OfflineBanner.tsx";
import { ApiError } from "../../../ports/api-error.ts";
import { toUiError } from "../../../shared/ui-error.ts";
import { Button } from "../../../ui/Button.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useMyCircle } from "../queries.ts";
import { CircleHeader } from "./CircleHeader.tsx";
import styles from "./CircleScreen.module.css";
import { EmptyCircle } from "./EmptyCircle.tsx";
import { MembersView } from "./MembersView.tsx";
import { WaitingRoom } from "./WaitingRoom.tsx";

function CircleFailure({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const { retryable } = toUiError(error);
  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>Círculo</h1>
      <div className={styles.failure} role="alert">
        <Icon name="cloud-off" size="lg" />
        <p className={styles.failureTitle}>
          {retryable ? "No pudimos cargar tu círculo." : "Algo salió mal"}
        </p>
        <p className={styles.lead}>
          {retryable ? "Revisa tu conexión e inténtalo de nuevo." : "Inténtalo de nuevo más tarde."}
        </p>
        {retryable && (
          <Button leadingIcon="rotate-cw" onClick={onRetry}>
            Reintentar
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * The Circle tab (WC-R6). It reads `/me/circle`, so it survives a reload, and shows one of three
 * states: no circle (31b), alone in it (the waiting room, 7) or with people (31a-lite). While the
 * viewer is alone it refetches every 30 s and on focus.
 */
export function CircleScreen() {
  const query = useMyCircle({ pollWhileSolo: true });
  const online = useOnline();
  const navigate = useNavigate();
  const { data } = query;
  if (data === undefined) {
    // Offline with nothing cached is an error, not an endless skeleton.
    if (query.isError || query.fetchStatus === "paused") {
      return (
        <CircleFailure
          error={query.error ?? new ApiError("NetworkError", 0, null)}
          onRetry={() => void query.refetch()}
        />
      );
    }
    return (
      <section className={styles.screen} aria-busy="true">
        <h1 className={styles.title}>Círculo</h1>
        <Skeleton shape="card" lines={2} />
      </section>
    );
  }
  const connectionLost =
    !online || (query.isError && toUiError(query.error).code === "NetworkError");
  const { circle } = data;
  const solo = circle?.members.length === 1;
  return (
    <>
      {connectionLost && <OfflineBanner />}
      {circle === null ? (
        <EmptyCircle />
      ) : (
        // One header above both views, so it (and anything open in it) survives the poll that finds
        // the second member and swaps the waiting room for the members view.
        <section className={styles.screen}>
          <CircleHeader
            circleId={circle.id}
            name={circle.name}
            eyebrow={
              !solo && data.season?.phase === "active" && data.season.week !== null
                ? `Semana ${data.season.week} de ${data.season.lengthWeeks}`
                : null
            }
            onInvite={solo ? undefined : () => navigate("/circle/invite")}
          />
          {solo ? (
            <WaitingRoom circle={circle} />
          ) : (
            <MembersView circle={circle} season={data.season} />
          )}
        </section>
      )}
    </>
  );
}
