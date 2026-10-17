import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { encouragementId, habitId, pauseRequestId, seasonId } from "../shared/ids.ts";
import {
  comebackKey,
  encouragementKey,
  graduationKey,
  MAX_FEED_KEY_LENGTH,
  parseFeedItemKey,
  pauseKey,
  recalcKey,
  seasonCloseKey,
  seasonStartKey,
  sessionKey,
  weekKey,
} from "./feed-key.ts";

const UUID = "0191a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b";
const OTHER = "0191a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c";

describe("feed item keys (a compatibility contract: they key the stored reactions)", () => {
  it("pins the exact format of every kind", () => {
    expect(sessionKey(commitmentId(UUID), 3)).toBe(`session:${UUID}:3`);
    expect(weekKey(commitmentId(UUID), 2)).toBe(`week:${UUID}:2`);
    expect(comebackKey(memberId(UUID), 12)).toBe(`comeback:${UUID}:12`);
    expect(pauseKey(pauseRequestId(UUID))).toBe(`pause:${UUID}`);
    expect(recalcKey(pauseRequestId(UUID))).toBe(`recalc:${UUID}`);
    expect(graduationKey(habitId(UUID))).toBe(`graduation:${UUID}`);
    expect(seasonStartKey(seasonId(UUID))).toBe(`season-start:${UUID}`);
    expect(seasonCloseKey(seasonId(UUID))).toBe(`season-close:${UUID}`);
    expect(encouragementKey(encouragementId(UUID))).toBe(`encouragement:${UUID}`);
  });

  it("round-trips every kind through the parser", () => {
    const cases = [
      [sessionKey(commitmentId(UUID), 3), { kind: "session", commitmentId: UUID, day: 3 }],
      [weekKey(commitmentId(UUID), 2), { kind: "week", commitmentId: UUID, week: 2 }],
      [comebackKey(memberId(OTHER), 12), { kind: "comeback", memberId: OTHER, day: 12 }],
      [pauseKey(pauseRequestId(UUID)), { kind: "pause", pauseRequestId: UUID }],
      [recalcKey(pauseRequestId(UUID)), { kind: "recalc", pauseRequestId: UUID }],
      [graduationKey(habitId(UUID)), { kind: "graduation", habitId: UUID }],
      [seasonStartKey(seasonId(UUID)), { kind: "seasonStart", seasonId: UUID }],
      [seasonCloseKey(seasonId(UUID)), { kind: "seasonClose", seasonId: UUID }],
      [encouragementKey(encouragementId(UUID)), { kind: "encouragement", encouragementId: UUID }],
    ] as const;
    for (const [key, parsed] of cases) expect(parseFeedItemKey(key)).toEqual(parsed);
  });

  it("accepts the readable ids the in-memory fixtures use", () => {
    expect(parseFeedItemKey("session:commitment-meditar:1")).toEqual({
      kind: "session",
      commitmentId: "commitment-meditar",
      day: 1,
    });
  });

  it.each([
    ["", "empty"],
    ["session", "no ids"],
    [`session:${UUID}`, "missing the day"],
    [`session:${UUID}:0`, "day 0 (numbers are 1-based)"],
    [`session:${UUID}:-1`, "a negative day"],
    [`session:${UUID}:1.5`, "a fractional day"],
    [`session:${UUID}:01`, "a leading zero"],
    [`session:${UUID}:3:9`, "too many parts"],
    [`week:${UUID}:0`, "week 0"],
    [`pause:${UUID}:1`, "too many parts for a pause"],
    [`unknown:${UUID}`, "an unknown kind"],
    [`Session:${UUID}:3`, "an uppercase kind"],
    [`session:${UUID}:3 `, "a trailing space"],
    [`session:${UUID.replace("a", " ")}:3`, "a space inside an id"],
    [`session:Andrea \u{1F525}:3`, "a name instead of an id"],
    [`entry:${UUID}`, "the superseded entry key"],
    [`season-start:`, "an empty id"],
    [`session::3`, "an empty id between separators"],
  ])("rejects %j (%s)", (key) => {
    expect(parseFeedItemKey(key)).toBeNull();
  });

  it("rejects a key over the maximum length", () => {
    expect(MAX_FEED_KEY_LENGTH).toBe(120);
    const long = `pause:${"a".repeat(MAX_FEED_KEY_LENGTH)}`;
    expect(parseFeedItemKey(long)).toBeNull();
    expect(
      parseFeedItemKey(`pause:${"a".repeat(MAX_FEED_KEY_LENGTH - "pause:".length)}`),
    ).not.toBeNull();
  });

  it("a builder refuses an id that would break the format", () => {
    expect(() => pauseKey(pauseRequestId("a:b"))).toThrow(RangeError);
    expect(() => sessionKey(commitmentId(UUID), 0)).toThrow(RangeError);
    expect(() => weekKey(commitmentId(UUID), 1.5)).toThrow(RangeError);
  });
});
