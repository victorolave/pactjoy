import type { Clock } from "../ports/clock.ts";

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}
