import { type MemberId, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import type { EntryRecord } from "../entry/entry.ts";
import { entryId, habitId, seasonId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { canSeeDetail, visibleNote } from "./privacy.ts";

const OWNER = "member-owner" as MemberId;
const OTHER = "member-other" as MemberId;

function commitment(privacy: "visible" | "private", id = "c-1") {
  return buildCommitment({
    id: commitmentId(id),
    memberId: OWNER,
    habitId: habitId("habit-1"),
    weightPercent: 100,
    privacy,
    measure: {
      unit: "done",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
    },
  });
}

function entry(note: string | null, id = "c-1"): EntryRecord {
  return {
    id: entryId("e-1"),
    seasonId: seasonId("season-1"),
    memberId: OWNER,
    commitmentId: commitmentId(id),
    day: seasonDay(1),
    recordedOn: seasonDay(1),
    recordedAt: instant(0),
    value: { kind: "done" },
    note,
    clientRequestId: "req-1",
    editedAt: null,
    version: 0,
    requestFingerprint: "fingerprint",
    deleted: false,
  };
}

describe("canSeeDetail", () => {
  it("shows a visible commitment to everyone", () => {
    expect(canSeeDetail(commitment("visible"), OTHER)).toBe(true);
    expect(canSeeDetail(commitment("visible"), OWNER)).toBe(true);
  });

  it("shows a private commitment only to its owner", () => {
    expect(canSeeDetail(commitment("private"), OWNER)).toBe(true);
    expect(canSeeDetail(commitment("private"), OTHER)).toBe(false);
  });
});

describe("visibleNote: evidence follows the commitment's privacy (A11)", () => {
  it("ER-14: another member sees the note of an entry on a visible commitment", () => {
    expect(visibleNote(entry("ran 5k"), commitment("visible"), OTHER)).toBe("ran 5k");
  });

  it("ER-15: another member does not see the note of an entry on a private commitment", () => {
    expect(visibleNote(entry("ran 5k"), commitment("private"), OTHER)).toBeNull();
  });

  it("the owner always sees their own note, even on a private commitment", () => {
    expect(visibleNote(entry("ran 5k"), commitment("private"), OWNER)).toBe("ran 5k");
  });

  it("returns null for an entry without a note", () => {
    expect(visibleNote(entry(null), commitment("visible"), OTHER)).toBeNull();
  });

  it("refuses an entry that does not belong to the commitment instead of guessing its privacy", () => {
    expect(() => visibleNote(entry("x", "c-2"), commitment("visible"), OTHER)).toThrow(
      /does not belong/,
    );
  });
});
