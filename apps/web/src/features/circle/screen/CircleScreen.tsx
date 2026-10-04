import { useOnline } from "../../../context/connectivity-context.tsx";
import { OfflineBanner } from "../../../platform/offline/OfflineBanner.tsx";
import { ApiError } from "../../../ports/api-error.ts";
import { toUiError } from "../../../shared/ui-error.ts";
import { Button } from "../../../ui/Button.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useMyCircle } from "../queries.ts";
import styles from "./CircleScreen.module.css";
import { EmptyCircle } from "./EmptyCircle.tsx";
import { MembersView } from "./MembersView.tsx";

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
  const query = useMyCircle();
  const online = useOnline();
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
  return (
    <>
      {connectionLost && <OfflineBanner />}
      {circle === null ? <EmptyCircle /> : <MembersView circle={circle} season={data.season} />}
    </>
  );
}
