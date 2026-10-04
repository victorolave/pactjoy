/**
 * How this app is running on the phone. Today it only answers the display mode (the welcome gate
 * skips the carousel in an installed app); the install step adds the platform and the install
 * prompt to this same port.
 */
export interface AppInstall {
  /** `standalone` when launched from the home screen, `browser` in a normal tab. */
  displayMode(): "standalone" | "browser";
}
