import { useOnline } from "../../app/connectivity-context.tsx";
import { ApiError } from "../../ports/api-error.ts";
import { longDate } from "../../shared/format.ts";
import { toUiError } from "../../shared/ui-error.ts";
import { Button } from "../../ui/Button.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { OfflineBanner } from "../offline/OfflineBanner.tsx";
import { useToday } from "./queries.ts";
import styles from "./TodayScreen.module.css";
import { NoCircle, NoSeason, NotStarted, PactOpen, RunningToday } from "./TodayStates.tsx";
import { type TodayModel, toTodayModel } from "./today-view-model.ts";

function TodayContent({ model }: { readonly model: TodayModel }) {
  switch (model.kind) {
    case "noCircle":
      return <NoCircle />;
    case "noSeason":
      return <NoSeason circleName={model.circleName} />;
    case "pactOpen":
      return <PactOpen model={model} />;
    case "notStarted":
      return <NotStarted model={model} />;
    case "active":
    case "ended":
      return <RunningToday model={model} />;
  }
}

/**
 * The greeting and the date paint at once (design 15e): they need no server. The name does, so the
 * skeleton greets without one; the rows are placeholders.
 */
function TodayLoading() {
  const date = longDate(new Date().toLocaleDateString("en-CA"));
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.meta}>{date}</div>
        <h1 className={styles.title}>Hola</h1>
      </header>
      <div className={styles.screen} role="status" aria-busy="true" aria-label="Cargando Hoy">
        <Skeleton shape="line" />
        <Skeleton shape="card" lines={3} />
      </div>
    </div>
  );
}

function TodayFailure({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const { retryable } = toUiError(error);
  return (
    <div className={styles.failure} role="alert">
      <span className={styles.failureGlyph}>
        <Icon name="cloud-off" size="lg" />
      </span>
      <p className={styles.sectionTitle}>
        {retryable ? "No pudimos cargar tu día." : "Algo salió mal"}
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
  );
}

export function TodayScreen() {
  const today = useToday();
  const online = useOnline();
  if (today.data === undefined) {
    // Offline with nothing saved is an error, not an endless skeleton (TO-S13).
    if (today.isError || today.fetchStatus === "paused") {
      return (
        <TodayFailure
          error={today.error ?? new ApiError("NetworkError", 0, null)}
          onRetry={() => void today.refetch()}
        />
      );
    }
    return <TodayLoading />;
  }
  // Data is on screen: a failed refetch keeps it. Only a lost connection says "sin conexión".
  const connectionLost =
    !online || (today.isError && toUiError(today.error).code === "NetworkError");
  return (
    <div className={styles.screen}>
      {connectionLost && <OfflineBanner />}
      <TodayContent model={toTodayModel(today.data)} />
    </div>
  );
}
