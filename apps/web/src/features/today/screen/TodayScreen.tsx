import type { ReactNode } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { OfflineBanner } from "../../../platform/offline/OfflineBanner.tsx";
import { ApiError } from "../../../ports/api-error.ts";
import { longDate } from "../../../shared/format.ts";
import { toUiError } from "../../../shared/ui-error.ts";
import { Button } from "../../../ui/Button.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { useToday } from "../queries.ts";
import { TodayRowSeasonContext } from "../rows/row-navigation.ts";
import { type TodayModel, toTodayModel } from "../today-view-model.ts";
import { TodayClosedWeek } from "./TodayClosedWeek.tsx";
import styles from "./TodayScreen.module.css";
import { TodaySkeleton } from "./TodaySkeleton.tsx";
import { NoCircle, NoSeason, NotStarted, PactOpen, RunningToday } from "./TodayStates.tsx";

function TodayContent({
  model,
  banner,
}: {
  readonly model: TodayModel;
  readonly banner: ReactNode;
}) {
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
      return (
        <TodayRowSeasonContext.Provider value={model.seasonId}>
          <RunningToday model={model} banner={banner} />
        </TodayRowSeasonContext.Provider>
      );
  }
}

/** The date and greeting paint at once (design 15e, 15f): they need no server, so no name yet. */
function TodayHeader() {
  const date = longDate(new Date().toLocaleDateString("en-CA"));
  return (
    <header className={styles.header}>
      <div className={styles.meta}>{date}</div>
      <h1 className={styles.title}>Hola</h1>
    </header>
  );
}

function TodayLoading() {
  return (
    <div className={styles.screen}>
      <TodayHeader />
      <TodaySkeleton />
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
    <div className={styles.failureScreen}>
      <TodayHeader />
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
      <TodayContent
        model={toTodayModel(today.data)}
        banner={<TodayClosedWeek view={today.data} localToday={today.localToday} />}
      />
    </div>
  );
}
