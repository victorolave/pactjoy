import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate, useParams } from "react-router";
import { loadDevToday } from "../config.ts";
import {
  CodeStep,
  EmailStep,
  LoginLayout,
  RedirectIfSignedIn,
  RequireSession,
} from "../features/auth/index.ts";
import {
  CircleScreen,
  CreateCircleScreen,
  InviteScreen,
  JoinCircleScreen,
  useMyCircle,
} from "../features/circle/index.ts";
import { HabitWizard } from "../features/habits/index.ts";
import {
  InstallStep,
  NameStep,
  NotificationStep,
  WelcomeCarousel,
} from "../features/onboarding/index.ts";
import {
  ChooseHabitsScreen,
  CreateSeasonScreen,
  PactScreen,
  WeightsScreen,
} from "../features/pact/index.ts";
import { ProfileScreen, SettingsScreen } from "../features/profile/index.ts";
import { SeasonScreen, SeasonSkeleton } from "../features/season/index.ts";
import { CommitmentScreen } from "../features/season-commitment/index.ts";
import { MemberSeasonScreen } from "../features/season-member/index.ts";
import { useSeasonProgress, useWeekSummary } from "../features/season-progress-data/index.ts";
import { WeeklyBanner, WeekSummaryScreen } from "../features/season-week/index.ts";
import { TodayScreen } from "../features/today/index.ts";
import { progressRoutePatterns, progressRoutes } from "../shared/season-progress-routes.ts";
import { Button } from "../ui/Button.tsx";
import { InlineMessage } from "../ui/InlineMessage.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { AppShell } from "./AppShell.tsx";
import { OnboardingGate } from "./OnboardingGate.tsx";
import styles from "./TabBar.module.css";
import { WelcomeGate } from "./WelcomeGate.tsx";

/** The Today scenario gallery; `null` in production (see `loadDevToday`). */
const DevToday = loadDevToday === null ? null : lazy(loadDevToday);

/** Current pre-season links enter the pact route, whose pactFlow owns the onward mapping.
 * Other season IDs stay server-authorized: a former participant may still read their season. */
function ProgressPhaseGate() {
  const { seasonId } = useParams();
  const query = useMyCircle();
  if (query.isPending) return <SeasonSkeleton />;
  const season = query.data?.season;
  if (
    season &&
    (seasonId === undefined || seasonId === season.id) &&
    (season.phase === "pactOpen" || season.phase === "notStarted")
  )
    return <Navigate to={`/season/${encodeURIComponent(season.id)}/pact`} replace />;
  return <Outlet />;
}

/** Shell-only composition: A2 owns SeasonScreen; no cross-feature navigation dependencies. */
function SeasonRoute() {
  const navigate = useNavigate();
  const { data } = useMyCircle();
  const season = data?.season;
  return (
    <div className={styles.season}>
      <SeasonScreen
        onNavigateToMember={(memberId) => {
          if (season) void navigate(progressRoutes.member(season.id, memberId));
        }}
        onNavigateToCommitment={(commitmentId) => {
          if (season) void navigate(progressRoutes.commitment(season.id, commitmentId));
        }}
      />
      {season && (season.phase === "active" || season.phase === "ended") && (
        <div className={styles.closedWeek}>
          <LatestClosedWeek seasonId={season.id} />
        </div>
      )}
    </div>
  );
}

function LatestClosedWeek({ seasonId }: { readonly seasonId: string }) {
  // Shares SeasonScreen's query/cache, never synthesizes a summary from rounded chart values.
  const { data } = useSeasonProgress(seasonId);
  if (!data || data.state === "notStarted") return null;
  const closed = data.weeks
    .filter((week) => week.timing === "past" || (data.state === "ended" && week.facts.counted))
    .at(-1);
  return closed ? <ClosedWeekCard seasonId={seasonId} weekIndex={closed.weekIndex} /> : null;
}

function ClosedWeekCard({
  seasonId,
  weekIndex,
}: {
  readonly seasonId: string;
  readonly weekIndex: number;
}) {
  const navigate = useNavigate();
  const query = useWeekSummary(seasonId, weekIndex);
  if (query.isPending)
    return (
      <div role="status" aria-label="Cargando temporada" aria-busy="true">
        <Skeleton shape="card" />
      </div>
    );
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
    <WeeklyBanner
      summary={query.data}
      onOpen={() => void navigate(progressRoutes.week(seasonId, weekIndex))}
    />
  );
}

/** Route table. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RedirectIfSignedIn />}>
        <Route element={<WelcomeGate />}>
          <Route path="welcome" element={<WelcomeCarousel />} />
          <Route path="welcome/install" element={<InstallStep />} />
          <Route element={<LoginLayout />}>
            <Route path="login" element={<EmailStep />} />
            <Route path="login/code" element={<CodeStep />} />
          </Route>
        </Route>
      </Route>
      {DevToday !== null && (
        <Route
          path="dev/today/*"
          element={
            <Suspense fallback={null}>
              <DevToday />
            </Suspense>
          }
        />
      )}
      <Route element={<RequireSession />}>
        <Route element={<OnboardingGate />}>
          <Route path="welcome/notifications" element={<NotificationStep />} />
          <Route path="welcome/name" element={<NameStep />} />
          <Route path="circle/new" element={<CreateCircleScreen />} />
          <Route path="circle/join" element={<JoinCircleScreen />} />
          <Route path="circle/invite" element={<InviteScreen />} />
          <Route path="season/new" element={<CreateSeasonScreen />} />
          <Route path="season/:seasonId/habits" element={<ChooseHabitsScreen />} />
          <Route path="season/:seasonId/weights" element={<WeightsScreen />} />
          <Route path="season/:seasonId/habits/new" element={<HabitWizard />} />
          <Route path="season/:seasonId/commitments/:commitmentId/edit" element={<HabitWizard />} />
          <Route path="season/:seasonId/pact" element={<PactScreen />} />
          <Route path="profile/settings" element={<SettingsScreen />} />
          <Route element={<ProgressPhaseGate />}>
            <Route path={progressRoutePatterns.week} element={<WeekSummaryScreen />} />
            <Route element={<AppShell />}>
              <Route path="season" element={<SeasonRoute />} />
              <Route path={progressRoutePatterns.member} element={<MemberSeasonScreen />} />
              <Route path={progressRoutePatterns.commitment} element={<CommitmentScreen />} />
            </Route>
          </Route>
          <Route element={<AppShell />}>
            <Route index element={<TodayScreen />} />
            <Route path="circle" element={<CircleScreen />} />
            <Route path="profile" element={<ProfileScreen />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
