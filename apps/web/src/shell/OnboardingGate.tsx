import { Navigate, Outlet, useLocation } from "react-router";
import { useAppInstall } from "../context/app-install-context.tsx";
import { useNotificationPermission } from "../context/notification-permission-context.tsx";
import { useMyCircle } from "../features/circle/index.ts";
import {
  onboardingRedirect,
  useNameDraft,
  useNotificationStep,
} from "../features/onboarding/index.ts";

/**
 * Sends a signed-in user to the onboarding flow (OB-R1, D8): the permission step first when due, then the name step for someone with no circle yet. The decision is
 * the pure `onboardingRedirect`; this only feeds it. It fails open: while `/me/circle` loads, when
 * it fails, or offline with nothing cached, the app renders as usual.
 */
export function OnboardingGate() {
  const { pathname } = useLocation();
  const { data } = useMyCircle();
  const { draft } = useNameDraft();
  const appInstall = useAppInstall();
  const notifications = useNotificationPermission();
  const { done: notificationStepDone } = useNotificationStep();
  const permissionPending =
    appInstall.displayMode() === "standalone" &&
    notifications.state() === "default" &&
    !notificationStepDone;
  const to = onboardingRedirect({
    pathname,
    hasCircle: data === undefined ? null : data.circle !== null,
    hasNameDraft: draft !== null,
    permissionPending,
  });
  return to === null ? <Outlet /> : <Navigate to={to} replace />;
}
