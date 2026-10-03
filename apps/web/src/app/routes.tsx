import { Navigate, Route, Routes } from "react-router";
import { CodeStep } from "../features/auth/CodeStep.tsx";
import { EmailStep } from "../features/auth/EmailStep.tsx";
import { LoginLayout } from "../features/auth/LoginLayout.tsx";
import { RedirectIfSignedIn, RequireSession } from "../features/auth/RequireSession.tsx";
import { ProfileScreen } from "../features/profile/ProfileScreen.tsx";
import { StubScreen } from "../features/stubs/StubScreen.tsx";
import { TodayScreen } from "../features/today/TodayScreen.tsx";
import { AppShell } from "./AppShell.tsx";

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
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<TodayScreen />} />
          <Route path="season" element={<StubScreen title="Temporada" />} />
          <Route path="circle" element={<StubScreen title="Círculo" />} />
          <Route path="profile" element={<ProfileScreen />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
