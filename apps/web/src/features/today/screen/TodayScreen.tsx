import type { TodayView } from "@pactjoy/app";
import type { ReactNode } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { OfflineBanner, SyncingBanner } from "../../../platform/offline/OfflineBanner.tsx";
import { ApiError } from "../../../ports/api-error.ts";
import { longDate } from "../../../shared/format.ts";
import { toUiError } from "../../../shared/ui-error.ts";
import { Button } from "../../../ui/Button.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { useOutboxReplaying, useOverlayToday } from "../../entry/index.ts";
import { useReminderNamesSync } from "../../notifications/index.ts";
import { PendingMarksContext } from "../pending-marks.ts";
import { useToday } from "../queries.ts";
import { TodayRowSeasonContext } from "../rows/row-navigation.ts";
import { type TodayModel, toTodayModel } from "../today-view-model.ts";
import { FirstFullWeekCelebration } from "./FirstFullWeekCelebration.tsx";
import { OutboxNotices } from "./OutboxNotices.tsx";
import { TodayClosedWeek } from "./TodayClosedWeek.tsx";
import styles from "./TodayScreen.module.css";
import { TodaySkeleton } from "./TodaySkeleton.tsx";
import { NoCircle, NoSeason, NotStarted, PactOpen, RunningToday } from "./TodayStates.tsx";

function TodayContent({
  model,
  banner,
  stale,
  staleNotice,
}: {
  readonly model: TodayModel;
  readonly banner: ReactNode;
  readonly stale: boolean;
  readonly staleNotice: boolean;
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
          <RunningToday model={model} banner={banner} stale={stale} staleNotice={staleNotice} />
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

/**
 * A running season's Today whose day is already over on this phone (its season clock), when the
 * server cannot vouch for it: the view was restored from storage, or the connection is lost. A tap
 * would otherwise be kept for yesterday. While the server answers, its day wins over a phone clock
 * that runs ahead; a phone clock behind it never closes anything.
 */
function isStaleDay(view: TodayView, localToday: string | null, serverVouches: boolean): boolean {
  if (view.state !== "active" || localToday === null || serverVouches) return false;
  return localToday > view.today;
}

export function TodayScreen() {
  const today = useToday();
  const online = useOnline();
  useReminderNamesSync(today.data);
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
    <TodayWithData
      data={today.data}
      localToday={today.localToday}
      fetchStartedAt={today.fetchStartedAt}
      connectionLost={connectionLost}
      fresh={!today.isError && !today.isFetching && !connectionLost && today.fromServer}
      stale={isStaleDay(today.data, today.localToday, today.fromServer && online && !today.isError)}
      loadingDay={online && today.isFetching}
    />
  );
}

/**
 * The server's Today with what is waiting on the phone laid over it (design 15g). The banner says
 * "sin conexión" while the connection is lost and "enviando" while the queue is being sent. The
 * first-full-week celebration reads the server's own view, never the overlay: what waits on the
 * phone is not a kept week.
 */
function TodayWithData({
  data,
  localToday,
  fetchStartedAt,
  connectionLost,
  fresh,
  stale,
  loadingDay,
}: {
  readonly data: TodayView;
  readonly localToday: string | null;
  readonly fetchStartedAt: number | null;
  readonly connectionLost: boolean;
  /** `data` is a settled answer the server gave in this session (see `FirstFullWeekCelebration`). */
  readonly fresh: boolean;
  /** The view's day is over on this phone and the server cannot be asked (see `isStaleDay`). */
  readonly stale: boolean;
  /** The server is being asked right now: the rows stay closed, but nothing is said yet. */
  readonly loadingDay: boolean;
}) {
  const sending = useOutboxReplaying();
  const { view, marks } = useOverlayToday(data, fetchStartedAt);
  return (
    <div className={styles.screen}>
      {connectionLost ? <OfflineBanner /> : sending && <SyncingBanner />}
      <OutboxNotices />
      <FirstFullWeekCelebration view={data} fresh={fresh} />
      <PendingMarksContext.Provider value={marks}>
        <TodayContent
          model={toTodayModel(view)}
          banner={<TodayClosedWeek view={view} localToday={localToday} />}
          stale={stale}
          staleNotice={stale && !loadingDay}
        />
      </PendingMarksContext.Provider>
    </div>
  );
}
