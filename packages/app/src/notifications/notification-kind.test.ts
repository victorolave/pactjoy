import { describe, expect, it } from "vitest";
import { KIND_POLICY, NOTIFICATION_KINDS, type NotificationKind } from "./notification-kind.ts";

/**
 * The set of notices is CLOSED (REQ-F1, ADR-0017): Notion forbids pushes about being overtaken,
 * losing, position changes, a lost streak or not having logged. Adding or removing a kind must be
 * a deliberate edit here, in `KIND_POLICY`, in the database CHECK and in the service-worker copy.
 */
const ALLOWED: readonly NotificationKind[] = [
  "pauseRequested",
  "pauseApproved",
  "pauseRejected",
  "pauseEndsTomorrow",
  "pactPendingApproval",
  "seasonStarted",
  "reviewDue",
  "seasonClosed",
  "commitmentReminder",
];

const FORBIDDEN_WORDS = [
  /overtak/i,
  /losing/i,
  /position/i,
  /rank/i,
  /streak/i,
  /notLogged/i,
  /missed/i,
];

describe("NotificationKind allowlist", () => {
  it("is exactly the agreed list, in order", () => {
    expect(NOTIFICATION_KINDS).toEqual(ALLOWED);
  });

  it("has a policy for every kind and nothing else", () => {
    expect(Object.keys(KIND_POLICY).sort()).toEqual([...ALLOWED].sort());
  });

  it("names no forbidden notice", () => {
    for (const kind of NOTIFICATION_KINDS) {
      for (const word of FORBIDDEN_WORDS) expect(kind).not.toMatch(word);
    }
  });

  it.each(["overtaken", "losingStreak", "positionChanged", "notLoggedToday", "missedDay"])(
    "the forbidden-word scan does catch %j (guards the guard)",
    (kind) => {
      expect(FORBIDDEN_WORDS.some((word) => word.test(kind))).toBe(true);
    },
  );
});

describe("KIND_POLICY", () => {
  it("sends event notices on the next tick and calendar notices at 09:00", () => {
    const immediate = NOTIFICATION_KINDS.filter((kind) => KIND_POLICY[kind].timing === "immediate");
    expect(immediate).toEqual([
      "pauseRequested",
      "pauseApproved",
      "pauseRejected",
      "pactPendingApproval",
    ]);
  });

  it("sends a reminder at its owner's chosen time, never shifted and never rolled over (REQ-R7)", () => {
    expect(KIND_POLICY.commitmentReminder).toEqual({ timing: "chosenTime", rollover: false });
    const chosen = NOTIFICATION_KINDS.filter((kind) => KIND_POLICY[kind].timing === "chosenTime");
    expect(chosen).toEqual(["commitmentReminder"]);
  });

  it("rolls a missed calendar notice over once, except the pause end (the next day is the end itself)", () => {
    const rollover = NOTIFICATION_KINDS.filter((kind) => KIND_POLICY[kind].rollover);
    expect(rollover).toEqual(["seasonStarted", "reviewDue", "seasonClosed"]);
  });
});
