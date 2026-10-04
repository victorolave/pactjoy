/** What the gate knows when a signed-in user lands on a path. */
export interface OnboardingInput {
  readonly pathname: string;
  /** `null` while unknown: loading, failed or offline. The gate never blocks on it. */
  readonly hasCircle: boolean | null;
  /** The name step was completed on this device (a name draft exists). */
  readonly hasNameDraft: boolean;
  /**
   * The permission step is due: running as an installed app, the browser has not been asked
   * (permission `default`) and the step was not done or skipped on this device (D9).
   */
  readonly permissionPending: boolean;
}

/** The notification-permission step: the first onboarding screen after login, standalone only. */
export const NOTIFICATIONS_PATH = "/welcome/notifications";

/** The name step: the first onboarding screen after login. */
export const NAME_STEP_PATH = "/welcome/name";

/** Paths of the flow, where a user without a circle must not be redirected again. */
const isFlowPath = (pathname: string): boolean =>
  pathname.startsWith("/welcome") || pathname.startsWith("/circle/");

/**
 * Screens only for someone who still has no circle; a member who opens one goes home. `/circle/new`
 * is NOT here on purpose: creating a circle makes the viewer a member while that screen is still
 * mounted, and redirecting from under it would drop the navigation that follows the mutation. A
 * member who opens it anyway is refused by the server (AlreadyInActiveCircle).
 */
const isNoCircleOnly = (pathname: string): boolean => pathname.startsWith("/welcome");

/**
 * Where a signed-in user belongs, or `null` to stay put. Pure, so it is a decision table (D8).
 *
 * - Permission step due: go there from anywhere, members included (it asks about this phone, not
 *   about circles). It does not wait for the circle state, so it also shows offline. Once it is
 *   not due, its screen sends the user home, where the rest of these rules apply.
 * - Unknown circle state (loading, error, offline): stay. The gate fails open.
 * - In a circle: the screens for people without one send the user home. Invite and join stay open
 *   (a member can invite, and joining by a code they already belong to explains why it fails).
 * - No circle and no name draft yet: start at the name step. Once the draft exists the user is
 *   free to leave the flow, and Today offers "Crear o unirme a un círculo".
 *
 * The welcome and install steps run before login, in `welcomeRedirect`.
 */
export function onboardingRedirect(input: OnboardingInput): string | null {
  if (input.permissionPending)
    return input.pathname === NOTIFICATIONS_PATH ? null : NOTIFICATIONS_PATH;
  if (input.pathname === NOTIFICATIONS_PATH) return "/";
  if (input.hasCircle === null) return null;
  if (input.hasCircle) return isNoCircleOnly(input.pathname) ? "/" : null;
  if (isFlowPath(input.pathname)) return null;
  return input.hasNameDraft ? null : NAME_STEP_PATH;
}
