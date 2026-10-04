/**
 * How this app is running on the phone, and whether the browser can install it. The welcome gate
 * skips the carousel in an installed app; the install step (D9) uses the platform and the prompt.
 */
export interface AppInstall {
  /** `standalone` when launched from the home screen, `browser` in a normal tab. */
  displayMode(): "standalone" | "browser";
  /** `ios` has no install prompt (the user adds the app by hand); everything else is `other`. */
  platform(): "ios" | "other";
  /** Whether the browser handed over a deferred install prompt that `prompt()` can show. */
  canPrompt(): boolean;
  /** Shows the install prompt. `unavailable` when there is none; a prompt is usable only once. */
  prompt(): Promise<"accepted" | "dismissed" | "unavailable">;
}
