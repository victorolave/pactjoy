import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { loadDevToday } from "../config.ts";
import {
  CodeStep,
  EmailStep,
  LoginLayout,
  RedirectIfSignedIn,
  RequireSession,
} from "../features/auth/index.ts";
import { CircleScreen, CreateCircleScreen, InviteScreen } from "../features/circle/index.ts";
import { NameStep } from "../features/onboarding/index.ts";
import { ProfileScreen } from "../features/profile/index.ts";
import { TodayScreen } from "../features/today/index.ts";
import { AppShell } from "./AppShell.tsx";
import { OnboardingGate } from "./OnboardingGate.tsx";
import { StubScreen } from "./StubScreen.tsx";

/** The Today scenario gallery; `null` in production (see `loadDevToday`). */
const DevToday = loadDevToday === null ? null : lazy(loadDevToday);

/** Route table. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RedirectIfSignedIn />}>
        <Route element={<LoginLayout />}>
          <Route path="login" element={<EmailStep />} />
          <Route path="login/code" element={<CodeStep />} />
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
          <Route path="welcome/name" element={<NameStep />} />
          <Route path="circle/new" element={<CreateCircleScreen />} />
          <Route path="circle/invite" element={<InviteScreen />} />
          <Route element={<AppShell />}>
            <Route index element={<TodayScreen />} />
            <Route path="season" element={<StubScreen title="Temporada" />} />
            <Route path="circle" element={<CircleScreen />} />
            <Route path="profile" element={<ProfileScreen />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
