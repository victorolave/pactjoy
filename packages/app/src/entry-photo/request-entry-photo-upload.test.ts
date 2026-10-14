import { describe, expect, it } from "vitest";
import { leaveCircle } from "../circle/leave-circle.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { instant } from "../time/instant.ts";
import {
  ATTACH_WINDOW_MS,
  MAX_OPEN_UPLOADS,
  MAX_PHOTO_BYTES,
  SWEEP_BATCH,
  UPLOAD_URL_TTL_SECONDS,
} from "./limits.ts";
import { OBJECT_KEY_PATTERN } from "./object-key.ts";
import { reservePhoto } from "./photo-fixtures.ts";
import {
  type RequestEntryPhotoUploadInput,
  requestEntryPhotoUpload,
} from "./request-entry-photo-upload.ts";

const NOW = localInstant(dayOf(5));

async function setup(status: "active" | "pactOpen" = "active") {
  const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH, status);
  const input = (
    extra: Partial<RequestEntryPhotoUploadInput> = {},
  ): RequestEntryPhotoUploadInput => ({
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    byteSize: 800 * 1024,
    contentType: "image/jpeg",
    ...extra,
  });
  const ledger = async () => app.entryPhotos.all();
  return { app, given, input, ledger };
}

describe("requestEntryPhotoUpload: reserving", () => {
  it("SC-U1: an active member reserves a slot and gets only the signed PUT, only inside the signed URL", async () => {
    const { app, given, input } = await setup();
    const result = await requestEntryPhotoUpload(app, given.andrea, input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { photoId, upload, attachBy } = result.value;
    expect(Object.keys(result.value).sort()).toEqual(["attachBy", "photoId", "upload"]);
    expect(upload.method).toBe("PUT");
    expect(upload.headers).toEqual({ "content-type": "image/jpeg" });
    expect(upload.expiresAt).toBe(NOW + 300_000);
    expect(attachBy).toBe(NOW + ATTACH_WINDOW_MS);

    const row = await app.uow.read(({ entryPhotos }) => entryPhotos.get(photoId));
    expect(row).toMatchObject({
      status: "pending",
      memberId: "member-andrea",
      commitmentId: given.andreaCommitment,
      seasonId: given.season.id,
      byteSize: 800 * 1024,
      createdAt: NOW,
      attachBy,
      version: 0,
    });
    expect(row?.objectKey).toMatch(OBJECT_KEY_PATTERN);
    expect(upload.url).toContain(row?.objectKey ?? "missing");
  });

  it("the reserved URL accepts exactly the reserved size and nothing else", async () => {
    const { app, given, input } = await setup();
    const result = await requestEntryPhotoUpload(app, given.andrea, input({ byteSize: 100 }));
    if (!result.ok) throw new Error("setup");
    expect(app.evidence.upload(result.value.upload, new Uint8Array(101))).toBe("rejected");
    expect(app.evidence.upload(result.value.upload, new Uint8Array(100))).toBe("accepted");
  });

  it("SC-U2: unknown season, a stranger and another member's commitment are refused, nothing stored", async () => {
    const { app, given, input, ledger } = await setup();
    expect(
      await requestEntryPhotoUpload(app, given.andrea, input({ seasonId: "nope" as never })),
    ).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
    expect(
      await requestEntryPhotoUpload(app, { userId: userId("user-stranger") }, input()),
    ).toEqual({ ok: false, error: { kind: "NotAMember" } });
    expect(
      await requestEntryPhotoUpload(app, given.victor, input()), // Andrea's commitment
    ).toEqual({ ok: false, error: { kind: "CommitmentNotOwned" } });
    expect(
      await requestEntryPhotoUpload(app, given.andrea, input({ commitmentId: "ghost" as never })),
    ).toEqual({ ok: false, error: { kind: "CommitmentNotOwned" } });
    expect(await ledger()).toEqual([]);
  });

  it("SC-U3: a member who left, and a season that is not active, are refused", async () => {
    const { app, given, input } = await setup();
    await leaveCircle(app, given.andrea, { circleId: given.circle.id });
    expect(await requestEntryPhotoUpload(app, given.andrea, input())).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });

    const open = await setup("pactOpen");
    expect(await requestEntryPhotoUpload(open.app, open.given.andrea, open.input())).toEqual({
      ok: false,
      error: { kind: "SeasonNotActive" },
    });
  });

  it("does not check the entry window, a pause or a day: record and edit are the gate", async () => {
    const { app, given, input } = await setup();
    // Long after the season: the slot is still reservable (it would simply expire unused).
    const late = atInstant(app, localInstant(dayOf(20)));
    expect((await requestEntryPhotoUpload(late, given.andrea, input())).ok).toBe(true);
  });

  it.each([
    ["empty", { byteSize: 0 }],
    ["empty", { byteSize: -5 }],
    ["empty", { byteSize: 1.5 }],
    ["tooLarge", { byteSize: MAX_PHOTO_BYTES + 1 }],
    ["type", { contentType: "image/png" }],
    ["type", { contentType: "" }],
  ] as const)("SC-U4: %s is an InvalidPhoto and touches nothing", async (reason, extra) => {
    const { app, given, input, ledger } = await setup();
    const result = await requestEntryPhotoUpload(app, given.andrea, input(extra as never));
    expect(result).toEqual({ ok: false, error: { kind: "InvalidPhoto", reason } });
    expect(await ledger()).toEqual([]);
  });

  it("accepts exactly MAX_PHOTO_BYTES", async () => {
    const { app, given, input } = await setup();
    expect(
      (await requestEntryPhotoUpload(app, given.andrea, input({ byteSize: MAX_PHOTO_BYTES }))).ok,
    ).toBe(true);
  });
});

describe("requestEntryPhotoUpload: the cap and the lazy cleanup", () => {
  it("SC-U5: the sixth open reservation is refused", async () => {
    const { app, given, input } = await setup();
    for (let n = 0; n < MAX_OPEN_UPLOADS; n++) {
      expect((await requestEntryPhotoUpload(app, given.andrea, input())).ok).toBe(true);
    }
    expect(await requestEntryPhotoUpload(app, given.andrea, input())).toEqual({
      ok: false,
      error: { kind: "TooManyPhotoUploads" },
    });
    // Another member has their own allowance.
    expect(
      (
        await requestEntryPhotoUpload(
          app,
          given.victor,
          input({ commitmentId: given.victorCommitment }),
        )
      ).ok,
    ).toBe(true);
  });

  it("W1: abandoned reservations stop counting once their upload URL is dead, long before attachBy", async () => {
    const { app, given, input } = await setup();
    for (let n = 0; n < MAX_OPEN_UPLOADS; n++) {
      await reservePhoto(app, given.andrea, given, given.andreaCommitment);
    }
    const ttlMs = UPLOAD_URL_TTL_SECONDS * 1000;
    // Still inside the URL TTL: the cap holds.
    const inside = atInstant(app, instant(NOW + ttlMs - 1));
    expect(await requestEntryPhotoUpload(inside, given.andrea, input())).toEqual({
      ok: false,
      error: { kind: "TooManyPhotoUploads" },
    });
    // Past the URL TTL but well before attachBy: the sixth succeeds.
    const dead = atInstant(app, instant(NOW + ttlMs));
    expect(NOW + ttlMs).toBeLessThan(NOW + ATTACH_WINDOW_MS);
    expect((await requestEntryPhotoUpload(dead, given.andrea, input())).ok).toBe(true);
  });

  it("SC-U5/U6/U7: once reservations expire they stop counting and are cleaned, objects included", async () => {
    const { app, given, input } = await setup();
    const reserved: Awaited<ReturnType<typeof reservePhoto>>[] = [];
    for (let n = 0; n < MAX_OPEN_UPLOADS; n++) {
      reserved.push(await reservePhoto(app, given.andrea, given, given.andreaCommitment));
    }
    // The first two were uploaded; their objects must be deleted by the cleanup.
    app.evidence.upload(reserved[0]?.upload as never, new Uint8Array(reserved[0]?.size ?? 0));
    app.evidence.upload(reserved[1]?.upload as never, new Uint8Array(reserved[1]?.size ?? 0));
    expect(app.evidence.keys()).toHaveLength(2);

    const later = atInstant(app, atAfterWindow(NOW));
    const fresh = await requestEntryPhotoUpload(later, given.andrea, input());
    expect(fresh.ok).toBe(true);

    const rows = await app.uow.read(async ({ entryPhotos }) =>
      entryPhotos.getMany(reserved.map((r) => r.photoId)),
    );
    expect(rows).toEqual([]); // all five expired rows were released AND purged
    expect(app.evidence.keys()).toEqual([]);
  });

  it("cleans only the actor's own rows (the sweep is member-scoped)", async () => {
    const { app, given, input } = await setup();
    const victorsPhoto = await reservePhoto(app, given.victor, given, given.victorCommitment);
    const later = atInstant(app, atAfterWindow(NOW));
    await requestEntryPhotoUpload(later, given.andrea, input());
    const row = await app.uow.read(({ entryPhotos }) => entryPhotos.get(victorsPhoto.photoId));
    expect(row?.status).toBe("pending"); // still there: Victor's turn will clean it
  });

  it("cleans at most SWEEP_BATCH rows per request", async () => {
    const { app, given, input } = await setup();
    for (let n = 0; n < SWEEP_BATCH + 5; n++) {
      await seedExpiredPending(app, given, n);
    }
    const later = atInstant(app, atAfterWindow(NOW));
    await requestEntryPhotoUpload(later, given.andrea, input());
    const remaining = await app.uow.read(({ entryPhotos }) => entryPhotos.listReleased(null, 100));
    const open = await app.uow.read(({ entryPhotos }) =>
      entryPhotos.countOpen(
        given.andrea ? ("member-andrea" as never) : ("" as never),
        instant(later.clock.now() - UPLOAD_URL_TTL_SECONDS * 1000),
      ),
    );
    expect(remaining).toEqual([]); // everything it released it also purged
    expect(open).toBe(1); // only the fresh reservation is open
    const leftover = await app.uow.read(({ entryPhotos }) =>
      entryPhotos.releaseExpired(null, later.clock.now(), 100),
    );
    expect(leftover).toHaveLength(5); // the 5 beyond the batch wait for the next request
  });

  it("a failing cleanup never blocks a reservation (errors swallowed)", async () => {
    const { app, given, input } = await setup();
    const old = await reservePhoto(app, given.andrea, given, given.andreaCommitment);
    app.evidence.upload(old.upload, new Uint8Array(old.size));
    const later = atInstant(app, atAfterWindow(NOW));
    app.evidence.failNext("delete", "unavailable");
    const result = await requestEntryPhotoUpload(later, given.andrea, input());
    expect(result.ok).toBe(true);
    // The row stays released for the next sweep.
    const row = await app.uow.read(({ entryPhotos }) => entryPhotos.get(old.photoId));
    expect(row?.status).toBe("released");
  });
});

function atAfterWindow(now: number): ReturnType<typeof localInstant> {
  return (now + ATTACH_WINDOW_MS + 1_000) as ReturnType<typeof localInstant>;
}

async function seedExpiredPending(
  app: Awaited<ReturnType<typeof setup>>["app"],
  given: Awaited<ReturnType<typeof setup>>["given"],
  n: number,
) {
  await app.uow.transaction(async ({ entryPhotos }) => {
    await entryPhotos.add({
      id: `seed-${n}` as never,
      seasonId: given.season.id,
      memberId: "member-andrea" as never,
      commitmentId: given.andreaCommitment,
      objectKey: `o/${n.toString(16).padStart(32, "0")}.jpg`,
      byteSize: 10,
      status: "pending",
      createdAt: (NOW - 10_000 + n) as never,
      attachBy: (NOW + 1_000) as never,
      version: 0,
    });
    return { ok: true as const, value: undefined };
  });
}
