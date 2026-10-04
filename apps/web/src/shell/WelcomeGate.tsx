import { Navigate, Outlet, useLocation } from "react-router";
import { useAppInstall } from "../context/app-install-context.tsx";
import { useWelcomeSeen, welcomeRedirect } from "../features/onboarding/index.ts";

/**
 * Sits in front of login (OB-R2, D9). Someone in a browser who has not seen the carousel goes to
 * it first; a launch from the home screen skips it. The decision is the pure `welcomeRedirect`;
 * this only feeds it.
 */
export function WelcomeGate() {
  const { pathname } = useLocation();
  const { seen } = useWelcomeSeen();
  const standalone = useAppInstall().displayMode() === "standalone";
  const to = welcomeRedirect({ pathname, standalone, welcomeSeen: seen });
  return to === null ? <Outlet /> : <Navigate to={to} replace />;
}
