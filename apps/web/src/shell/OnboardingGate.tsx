import { Navigate, Outlet, useLocation } from "react-router";
import { useMyCircle } from "../features/circle/index.ts";
import { onboardingRedirect, useNameDraft } from "../features/onboarding/index.ts";

/**
 * Sends a signed-in user who has no circle yet to the onboarding flow (OB-R1, D8). The decision is
 * the pure `onboardingRedirect`; this only feeds it. It fails open: while `/me/circle` loads, when
 * it fails, or offline with nothing cached, the app renders as usual.
 */
export function OnboardingGate() {
  const { pathname } = useLocation();
  const { data } = useMyCircle();
  const { draft } = useNameDraft();
  const to = onboardingRedirect({
    pathname,
    hasCircle: data === undefined ? null : data.circle !== null,
    hasNameDraft: draft !== null,
  });
  return to === null ? <Outlet /> : <Navigate to={to} replace />;
}
