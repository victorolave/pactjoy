import { useOnline } from "../../app/connectivity-context.tsx";
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

function TodayLoading() {
  return (
    <div className={styles.screen} role="status" aria-busy="true" aria-label="Cargando Hoy">
      <Skeleton shape="line" lines={2} />
      <Skeleton shape="card" lines={3} />
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
  if (today.isPending) return <TodayLoading />;
  if (today.isError)
    return <TodayFailure error={today.error} onRetry={() => void today.refetch()} />;
  return (
    <div className={styles.screen}>
      {!online && <OfflineBanner />}
      <TodayContent model={toTodayModel(today.data)} />
    </div>
  );
}
