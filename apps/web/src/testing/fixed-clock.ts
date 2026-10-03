import type { Clock } from "../ports/clock.ts";

export class FixedClock implements Clock {
  #nowMs: number;

  constructor(nowMs: number) {
    this.#nowMs = nowMs;
  }

  nowMs(): number {
    return this.#nowMs;
  }

  advanceSeconds(seconds: number): void {
    this.#nowMs += seconds * 1000;
  }
}
