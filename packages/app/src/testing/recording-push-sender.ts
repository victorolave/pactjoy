import type { PushMessage, PushOutcome, PushSender, PushTarget } from "../ports/push-sender.ts";
import type { Instant } from "../time/instant.ts";

/** One `send` the fake received, with the payload decoded back to JSON. */
export interface RecordedPush {
  readonly target: PushTarget;
  readonly message: PushMessage;
  readonly payload: unknown;
  readonly now: Instant;
}

export interface RecordingPushSenderOptions {
  /** Which endpoints `accepts` allows; any https URL by default. */
  readonly accepts?: (endpoint: string) => boolean;
  /** The outcome of each send; `delivered` by default. */
  readonly outcome?: (target: PushTarget) => PushOutcome;
}

export interface RecordingPushSender extends PushSender {
  readonly sent: readonly RecordedPush[];
  /** Changes the outcome of later sends. */
  respondWith(outcome: (target: PushTarget) => PushOutcome): void;
}

/** A {@link PushSender} for tests: records every message and answers what the test says. */
export function createRecordingPushSender(
  options: RecordingPushSenderOptions = {},
): RecordingPushSender {
  const sent: RecordedPush[] = [];
  let outcome = options.outcome ?? ((): PushOutcome => ({ kind: "delivered" }));
  return {
    applicationServerKey: `B${"Q".repeat(86)}`,
    accepts: options.accepts ?? ((endpoint) => endpoint.startsWith("https://")),
    async send(target, message, now) {
      sent.push({ target, message, payload: JSON.parse(message.payload), now });
      return outcome(target);
    },
    get sent() {
      return sent;
    },
    respondWith(next) {
      outcome = next;
    },
  };
}
