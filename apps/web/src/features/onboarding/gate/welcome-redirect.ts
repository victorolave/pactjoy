/** What the welcome gate knows when someone who is not signed in lands on a path. */
export interface WelcomeInput {
  readonly pathname: string;
  /** Launched from the home screen. */
  readonly standalone: boolean;
  /** The carousel was already seen (or skipped) on this device. */
  readonly welcomeSeen: boolean;
  /** The browser can install the app: iOS (by hand) or a deferred install prompt (Android). */
  readonly installable: boolean;
  /** The install step was already done or skipped on this device. */
  readonly installDone: boolean;
}

/** The welcome carousel, public and before login (D9). */
export const WELCOME_PATH = "/welcome";

/** The install step: "add to home screen", public and before login (D9). */
export const INSTALL_PATH = "/welcome/install";

/**
 * The public welcome paths, compared exactly. Not a prefix: `/welcomefoo` is no welcome path, and
 * the post-login `/welcome/name` is not public (it lives behind the session, under OnboardingGate).
 */
const PUBLIC_WELCOME_PATHS: ReadonlySet<string> = new Set([WELCOME_PATH, INSTALL_PATH]);

/**
 * Where someone who is not signed in belongs, or `null` to stay put. Pure (D8, D9).
 *
 * - Installed app (standalone): the carousel and the install step happened in Safari, before
 *   installing, so go straight to login. iOS gives a home-screen app its own storage, so the
 *   order carousel, install, login means one login, in the installed app.
 * - Browser, carousel not seen yet: any other public path (login) goes to the carousel first.
 * - Browser, carousel seen, install step pending where the browser can install (iOS, or a
 *   browser with an install prompt, desktop Chrome and Edge included): login goes to the install
 *   step. A browser that cannot install never sees the step, and opening it directly goes to
 *   login.
 * - Otherwise stay. The carousel stays reachable, so it can be opened again.
 */
export function welcomeRedirect(input: WelcomeInput): string | null {
  const onWelcome = PUBLIC_WELCOME_PATHS.has(input.pathname);
  if (input.standalone) return onWelcome ? "/login" : null;
  if (input.pathname === INSTALL_PATH) return input.installable ? null : "/login";
  if (onWelcome) return null;
  if (!input.welcomeSeen) return WELCOME_PATH;
  return input.installable && !input.installDone ? INSTALL_PATH : null;
}
