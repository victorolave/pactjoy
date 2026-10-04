import { Navigate, Outlet, useLocation } from "react-router";
import { useAppInstall } from "../context/app-install-context.tsx";
import { useInstallStep, useWelcomeSeen, welcomeRedirect } from "../features/onboarding/index.ts";

/**
 * Sits in front of login (OB-R2, D9). Someone in a browser who has not seen the carousel goes to
 * it first, then to the install step wherever the browser can install; a launch from the home
 * screen skips both. The decision is the pure `welcomeRedirect`; this only feeds it.
 *
 * `canPrompt()` is read when the gate renders. A `beforeinstallprompt` that arrives later means
 * the step is skipped for that visit; the carousel usually gives the event time to arrive.
 */
export function WelcomeGate() {
  const { pathname } = useLocation();
  const { seen } = useWelcomeSeen();
  const { done: installDone } = useInstallStep();
  const appInstall = useAppInstall();
  const standalone = appInstall.displayMode() === "standalone";
  const installable = appInstall.platform() === "ios" || appInstall.canPrompt();
  const to = welcomeRedirect({ pathname, standalone, welcomeSeen: seen, installable, installDone });
  return to === null ? <Outlet /> : <Navigate to={to} replace />;
}
