import type { CommitmentId, MemberId } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { entryPhotoId, seasonId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { isOpenReservation, pendingEntryPhoto } from "./entry-photo.ts";
import { ATTACH_WINDOW_MS, MAX_PHOTO_BYTES } from "./limits.ts";

const base = {
  id: entryPhotoId("photo-1"),
  seasonId: seasonId("season-1"),
  memberId: "member-andrea" as MemberId,
  commitmentId: "commitment-1" as CommitmentId,
  objectKey: "o/0123456789abcdef0123456789abcdef.jpg",
  byteSize: 800 * 1024,
  now: instant(1_791_892_800_000),
};

describe("pendingEntryPhoto", () => {
  it("starts pending at version 0 and must be attached within the attach window", () => {
    const photo = pendingEntryPhoto(base);
    expect(photo).toEqual({
      id: base.id,
      seasonId: base.seasonId,
      memberId: base.memberId,
      commitmentId: base.commitmentId,
      objectKey: base.objectKey,
      byteSize: base.byteSize,
      status: "pending",
      createdAt: base.now,
      attachBy: instant(base.now + ATTACH_WINDOW_MS),
      version: 0,
    });
  });

  it.each([0, -1, 1.5, MAX_PHOTO_BYTES + 1])("refuses a byte size of %s", (byteSize) => {
    expect(() => pendingEntryPhoto({ ...base, byteSize })).toThrow(RangeError);
  });

  it("refuses an object key that is not minted by mintObjectKey", () => {
    expect(() => pendingEntryPhoto({ ...base, objectKey: "photos/andrea.jpg" })).toThrow(
      RangeError,
    );
  });
});

describe("isOpenReservation", () => {
  it("is true only for a pending photo strictly before attachBy", () => {
    const photo = pendingEntryPhoto(base);
    expect(isOpenReservation(photo, base.now)).toBe(true);
    expect(isOpenReservation(photo, instant(photo.attachBy - 1))).toBe(true);
    expect(isOpenReservation(photo, photo.attachBy)).toBe(false);
    expect(isOpenReservation({ ...photo, status: "attached" }, base.now)).toBe(false);
    expect(isOpenReservation({ ...photo, status: "released" }, base.now)).toBe(false);
  });
});
