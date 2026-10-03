import type { Haptics } from "../ports/haptics.ts";

/** Counts taps for tests. */
export class FakeHaptics implements Haptics {
  taps = 0;

  tap(): void {
    this.taps += 1;
  }
}
