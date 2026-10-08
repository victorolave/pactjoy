import type { TodayView } from "@pactjoy/app";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useDeviceStore } from "../../../context/device-store-context.tsx";
import { weeklySummaryDismissalKey } from "../../../platform/weekly-summary-dismissal.ts";
import { daysBetween } from "../../../shared/date.ts";
import { progressRoutes } from "../../../shared/season-progress-routes.ts";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useWeekSummary } from "../../season-progress-data/index.ts";
import { WeeklyBanner } from "../../season-week/index.ts";
import styles from "./TodayScreen.module.css";

export function TodayClosedWeek({
  view,
  localToday,
}: {
  readonly view: TodayView;
  readonly localToday: string | null;
}) {
  if (
    (view.state !== "active" && view.state !== "ended") ||
    view.season.actualStart === null ||
    localToday !== view.today
  )
    return null;
  const day = daysBetween(view.season.actualStart, localToday);
  if (day < 7 || day > view.season.lengthWeeks * 7 || day % 7 !== 0) return null;
  const weekIndex = day / 7 - 1;
  const flag = weeklySummaryDismissalKey(view.viewerId, view.season.id, weekIndex);
  return <ClosedWeek key={flag} flag={flag} seasonId={view.season.id} weekIndex={weekIndex} />;
}

function ClosedWeek({
  flag,
  seasonId,
  weekIndex,
}: {
  readonly flag: ReturnType<typeof weeklySummaryDismissalKey>;
  readonly seasonId: string;
  readonly weekIndex: number;
}) {
  const device = useDeviceStore();
  const [consumed, setConsumed] = useState(() => device.get(flag) === "1");
  return consumed ? null : (
    <AvailableWeek
      seasonId={seasonId}
      weekIndex={weekIndex}
      onOpen={() => {
        device.set(flag, "1");
        setConsumed(true);
      }}
    />
  );
}

function AvailableWeek({
  seasonId,
  weekIndex,
  onOpen,
}: {
  readonly seasonId: string;
  readonly weekIndex: number;
  readonly onOpen: () => void;
}) {
  const query = useWeekSummary(seasonId, weekIndex);
  const navigate = useNavigate();
  if (query.isPending) return <Skeleton shape="card" lines={2} />;
  if (query.isError)
    return (
      <InlineMessage
        tone="error"
        title="No pudimos cargar la temporada."
        action={
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  return (
    <div className={styles.weeklyBanner} aria-live="polite">
      <WeeklyBanner
        summary={query.data}
        onOpen={() => {
          onOpen();
          navigate(progressRoutes.week(seasonId, weekIndex));
        }}
      />
    </div>
  );
}
