import type { Haptics } from "../ports/haptics.ts";

const TAP_MS = 12;

/** `navigator.vibrate` where it exists. Elsewhere (desktop, iOS Safari) the visual is the feedback. */
export class BrowserHaptics implements Haptics {
  tap(): void {
    try {
      navigator.vibrate?.(TAP_MS);
    } catch {
      // Blocked or unsupported: nothing to do.
    }
  }
}
