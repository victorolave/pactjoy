/** What the welcome gate knows when someone who is not signed in lands on a path. */
export interface WelcomeInput {
  readonly pathname: string;
  /** Launched from the home screen. */
  readonly standalone: boolean;
  /** The carousel was already seen (or skipped) on this device. */
  readonly welcomeSeen: boolean;
}

/** The welcome carousel, public and before login (D9). */
export const WELCOME_PATH = "/welcome";

/**
 * Where someone who is not signed in belongs, or `null` to stay put. Pure (D8, D9).
 *
 * - Installed app (standalone): the carousel and the install step happened in Safari, before
 *   installing, so go straight to login. iOS gives a home-screen app its own storage, so the
 *   order carousel, install, login means one login, in the installed app.
 * - Browser, carousel not seen yet: any other public path (login) goes to the carousel first.
 * - Browser, carousel seen: stay. The carousel stays reachable, so it can be opened again.
 *
 * Seam for the install step: it adds its own condition here (a browser that has not seen it).
 */
export function welcomeRedirect(input: WelcomeInput): string | null {
  const onWelcome = input.pathname.startsWith(WELCOME_PATH);
  if (input.standalone) return onWelcome ? "/login" : null;
  return onWelcome || input.welcomeSeen ? null : WELCOME_PATH;
}
