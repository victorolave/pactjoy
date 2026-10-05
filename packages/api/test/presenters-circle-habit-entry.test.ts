import {
  type Circle,
  circleId,
  type EntryRecord,
  type EntryTombstone,
  entryId,
  type Habit,
  habitId,
  instant,
  memberId,
  seasonId,
  userId,
} from "@pactjoy/app";
import { type CommitmentId, parseDecimal, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { presentCircle, presentInvite } from "../src/presenters/circle.ts";
import {
  presentEditEntryResult,
  presentEntry,
  presentRecordEntryResult,
} from "../src/presenters/entry.ts";
import { presentHabit } from "../src/presenters/habit.ts";
import { presentInstant } from "../src/presenters/time.ts";

const ME = userId("u-me");
const ME_MEMBER = memberId("m1");
const OTHER = userId("u-other");
const T = instant(1_700_000_000_123);
const ISO = "2023-11-14T22:13:20.123Z";

const invite = {
  code: "AB3D7K" as never,
  createdAt: T,
  expiresAt: instant(T + 1000),
  createdBy: memberId("m1"),
};

const circle: Circle = {
  id: circleId("c1"),
  name: "Pals",
  members: [
    {
      id: memberId("m1"),
      userId: ME,
      displayName: "Me",
      status: "active",
      joinedAt: T,
      leftAt: null,
    },
    {
      id: memberId("m2"),
      userId: OTHER,
      displayName: "Other",
      status: "left",
      joinedAt: T,
      leftAt: instant(0),
    },
  ],
  invite,
  createdAt: T,
  archivedAt: null,
  version: 3,
};

const habit: Habit = {
  id: habitId("h1"),
  ownerId: ME,
  name: "Run",
  why: null,
  category: "health",
  icon: "book",
  createdAt: T,
  version: 1,
};

const entry: EntryRecord = {
  id: entryId("e1"),
  seasonId: seasonId("s1"),
  memberId: memberId("m1"),
  commitmentId: "k1" as CommitmentId,
  day: seasonDay(3),
  recordedOn: seasonDay(3),
  recordedAt: T,
  clientRequestId: "req-1",
  editedAt: null,
  version: 0,
  requestFingerprint: '["quantity","15/2","secret note"]',
  value: { kind: "quantity", value: parseDecimal("7.5") },
  note: "secret note",
  deleted: false,
};

const tombstone: EntryTombstone = { ...entry, value: null, note: null, deleted: true };

/** Walks every value (no bigint/function/undefined/Date) and returns all keys seen. */
function walk(value: unknown, keys: string[] = []): string[] {
  expect(typeof value).not.toBe("bigint");
  expect(typeof value).not.toBe("function");
  expect(typeof value).not.toBe("undefined");
  expect(value instanceof Date).toBe(false);
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.push(k);
      walk(v, keys);
    }
  }
  return keys;
}

describe("presenters: circle, habit, entry", () => {
  it("PR-S15: instants are ISO UTC with milliseconds everywhere", () => {
    expect(presentInstant(T)).toBe(ISO);
    const dto = presentCircle(circle, { userId: ME });
    expect(dto.createdAt).toBe(ISO);
    expect(dto.members[0]?.joinedAt).toBe(ISO);
    expect(dto.members[1]?.leftAt).toBe("1970-01-01T00:00:00.000Z");
    expect(presentEntry(entry, ME_MEMBER).recordedAt).toBe(ISO);
    expect(presentHabit(habit).createdAt).toBe(ISO);
  });

  it("PR-S13: circle exposes status/leftAt/isYou and never userId, name or email keys", () => {
    const dto = presentCircle(circle, { userId: ME });
    expect(dto.members.map((m) => [m.id, m.status, m.isYou])).toEqual([
      ["m1", "active", true],
      ["m2", "left", false],
    ]);
    const keys = walk(dto);
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("email");
    expect(JSON.stringify(dto)).not.toContain("u-me");
    expect(JSON.stringify(dto)).not.toContain("u-other");
  });

  it("SQ-9/SQ-12: every member, active or left, carries a displayName", () => {
    const dto = presentCircle(circle, { userId: ME });
    expect(dto.members.map((m) => [m.id, m.displayName])).toEqual([
      ["m1", "Me"],
      ["m2", "Other"],
    ]);
  });

  it("invite is shown only to an active viewer", () => {
    expect(presentCircle(circle, { userId: ME }).invite).toEqual({
      code: "AB3D7K",
      createdAt: ISO,
      expiresAt: "2023-11-14T22:13:21.123Z",
    });
    expect(Object.keys(presentCircle(circle, { userId: ME }).invite ?? {}).sort()).toEqual([
      "code",
      "createdAt",
      "expiresAt",
    ]);
    expect(presentCircle(circle, { userId: OTHER }).invite).toBeNull();
    expect(presentCircle(circle, { userId: userId("u-stranger") }).invite).toBeNull();
  });

  it("PR-S1/S4/S12: entry has exact decimal value, replayed flag, no requestFingerprint", () => {
    const dto = presentRecordEntryResult({ entry, replayed: true, memberId: ME_MEMBER }, ME_MEMBER);
    expect(dto.replayed).toBe(true);
    expect(dto.entry.value).toEqual({ kind: "quantity", value: "7.5" });
    expect(dto.entry.note).toBe("secret note");
    const keys = walk(dto);
    expect(keys).not.toContain("requestFingerprint");
    expect(keys).not.toContain("userId");
    // The note text appears only in the note field.
    expect(JSON.stringify({ ...dto.entry, note: null })).not.toContain("secret note");
  });

  it("PR-S4: a foreign entry is never presented (note would leak)", () => {
    const foreign = memberId("m-other");
    expect(() => presentEntry(entry, foreign)).toThrow(/not the viewer's own/);
    expect(() =>
      presentRecordEntryResult({ entry, replayed: false, memberId: ME_MEMBER }, foreign),
    ).toThrow();
    expect(() => presentEditEntryResult({ entry, memberId: ME_MEMBER }, foreign)).toThrow();
    expect(presentEditEntryResult({ entry, memberId: ME_MEMBER }, ME_MEMBER).entry.note).toBe(
      "secret note",
    );
  });

  it("entry variants: done, missed and tombstone", () => {
    expect(presentEntry({ ...entry, value: { kind: "done" } }, ME_MEMBER).value).toEqual({
      kind: "done",
    });
    expect(
      presentEntry({ ...entry, value: { kind: "missed" }, note: null }, ME_MEMBER).value,
    ).toEqual({
      kind: "missed",
    });
    expect(presentEntry(tombstone, ME_MEMBER)).toMatchObject({
      value: null,
      note: null,
      deleted: true,
    });
  });

  it("PR-S14/S16: round-trips through JSON without loss and is pure", () => {
    const outputs = [
      presentCircle(circle, { userId: ME }),
      presentInvite(invite),
      presentHabit(habit),
      presentRecordEntryResult({ entry, replayed: false, memberId: ME_MEMBER }, ME_MEMBER),
      presentEntry(tombstone, ME_MEMBER),
    ];
    for (const out of outputs) {
      walk(out);
      expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    }
    expect(presentCircle(circle, { userId: ME })).toEqual(presentCircle(circle, { userId: ME }));
  });

  it("habit omits ownerId", () => {
    expect(presentHabit(habit)).toEqual({
      id: "h1",
      name: "Run",
      why: null,
      category: "health",
      icon: "book",
      createdAt: ISO,
      version: 1,
    });
  });
});
