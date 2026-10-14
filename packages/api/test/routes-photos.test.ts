import type { SignedRequest } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createThrownMapper } from "../src/errors/thrown.ts";
import { givenActiveSeason, givenTwoMemberSeason, MINUTES } from "./entries-fixture.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type World = Awaited<ReturnType<typeof givenActiveSeason>>;

/** Plays the browser: PUTs `size` JPEG bytes to the signed request the API handed out. */
function upload(
  world: Pick<World, "app">,
  data: { upload: Record<string, unknown> },
  size: number,
) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  const upload = data.upload as {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
  };
  const request: SignedRequest = {
    url: upload.url,
    method: upload.method,
    headers: upload.headers,
    expiresAt: Date.parse(upload.expiresAt) as never,
  };
  return world.app.evidence.upload(request, bytes);
}

const reserve = (world: World, size = 4096, who = "andrea") =>
  world.call("POST", `/seasons/${world.seasonId}/commitments/${world.commitmentId}/photos`, who, {
    byteSize: size,
    contentType: "image/jpeg",
  });

async function uploaded(world: World, size = 4096) {
  const reserved = await reserve(world, size);
  expect(reserved.status).toBe(201);
  expect(upload(world, reserved.json.data, size)).toBe("accepted");
  return reserved.json.data.photoId as string;
}

describe("POST /seasons/:seasonId/commitments/:commitmentId/photos", () => {
  it("201 with exactly { photoId, upload { method, url, headers, expiresAt }, attachBy }", async () => {
    const world = await givenActiveSeason(MINUTES);
    const { status, json } = await reserve(world);
    expect(status).toBe(201);
    expect(Object.keys(json.data).sort()).toEqual(["attachBy", "photoId", "upload"]);
    expect(json.data.photoId).toMatch(UUID);
    expect(Object.keys(json.data.upload).sort()).toEqual(["expiresAt", "headers", "method", "url"]);
    expect(json.data.upload.method).toBe("PUT");
    expect(json.data.upload.headers).toEqual({ "content-type": "image/jpeg" });
    expect(Date.parse(json.data.upload.expiresAt)).toBe(1_700_000_000_000 + 300_000);
    expect(Date.parse(json.data.attachBy) - Date.parse(json.data.upload.expiresAt)).toBeGreaterThan(
      0,
    );
  });

  it("422 InvalidRequest for a bad body: missing, non-integer, unknown field", async () => {
    const world = await givenActiveSeason(MINUTES);
    const path = `/seasons/${world.seasonId}/commitments/${world.commitmentId}/photos`;
    for (const body of [
      {},
      { byteSize: 1.5, contentType: "image/jpeg" },
      { byteSize: "100", contentType: "image/jpeg" },
      { byteSize: 100 },
      { byteSize: 100, contentType: "image/jpeg", objectKey: "o/x.jpg" },
      { byteSize: 100, contentType: "image/jpeg", memberId: "m" },
    ]) {
      const { status, json } = await world.call("POST", path, "andrea", body);
      expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    }
    const bad = await world.call(
      "POST",
      "/seasons/not-a-uuid/commitments/also-not/photos",
      "andrea",
      { byteSize: 1, contentType: "image/jpeg" },
    );
    expect([bad.status, bad.json.error.code]).toEqual([422, "InvalidRequest"]);
  });

  it("422 InvalidPhoto with the reason as details; byteSize 0 is empty, 4 MiB is tooLarge, png is type", async () => {
    const world = await givenActiveSeason(MINUTES);
    const path = `/seasons/${world.seasonId}/commitments/${world.commitmentId}/photos`;
    const ask = (body: object) => world.call("POST", path, "andrea", body);
    expect(
      (await ask({ byteSize: 4 * 1024 * 1024, contentType: "image/jpeg" })).json.error,
    ).toMatchObject({
      code: "InvalidPhoto",
      details: { reason: "tooLarge" },
    });
    expect((await ask({ byteSize: 10, contentType: "image/png" })).json.error.details).toEqual({
      reason: "type",
    });
    // The schema's own minimum rejects 0 before the use case: still a client error.
    expect((await ask({ byteSize: 0, contentType: "image/jpeg" })).status).toBe(422);
  });

  it("401 without a token, 403 for another member's commitment, 404 for an unknown season", async () => {
    const world = await givenTwoMemberSeason(MINUTES);
    const path = (seasonId: string, commitmentId: string) =>
      `/seasons/${seasonId}/commitments/${commitmentId}/photos`;
    const body = { byteSize: 100, contentType: "image/jpeg" };
    const none = await world.call(
      "POST",
      path(world.seasonId, world.commitmentIds.andrea),
      "",
      body,
    );
    expect(none.status).toBe(401);
    const foreign = await world.call(
      "POST",
      path(world.seasonId, world.commitmentIds.andrea),
      "victor",
      body,
    );
    expect([foreign.status, foreign.json.error.code]).toEqual([403, "CommitmentNotOwned"]);
    const unknown = await world.call(
      "POST",
      path("aaaaaaaa-0000-4000-8000-0000000000aa", world.commitmentIds.andrea),
      "andrea",
      body,
    );
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "SeasonNotFound"]);
  });

  it("409 TooManyPhotoUploads on the sixth open reservation", async () => {
    const world = await givenActiveSeason(MINUTES);
    for (let n = 0; n < 5; n++) expect((await reserve(world)).status).toBe(201);
    const sixth = await reserve(world);
    expect([sixth.status, sixth.json.error.code]).toEqual([409, "TooManyPhotoUploads"]);
  });
});

describe("entries with a photo", () => {
  const record = (world: World, extra: object = {}) =>
    world.call("POST", world.path, "andrea", {
      commitmentId: world.commitmentId,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "req-1",
      ...extra,
    });

  it("POST records the photo; the entry says photoId, a replay returns the same", async () => {
    const world = await givenActiveSeason(MINUTES);
    const photoId = await uploaded(world);
    const first = await record(world, { photoId });
    expect(first.status).toBe(201);
    expect(first.json.data.entry.photoId).toBe(photoId);
    const again = await record(world, { photoId });
    expect([again.status, again.json.data.replayed, again.json.data.entry.photoId]).toEqual([
      200,
      true,
      photoId,
    ]);
  });

  it("an entry without a photo says photoId: null", async () => {
    const world = await givenActiveSeason(MINUTES);
    const { json } = await record(world);
    expect(json.data.entry.photoId).toBeNull();
    expect(Object.keys(json.data.entry)).toContain("photoId");
  });

  it("POST photoId must be a uuid or null; an unknown one is a 404 PhotoNotFound", async () => {
    const world = await givenActiveSeason(MINUTES);
    expect((await record(world, { photoId: "nope" })).status).toBe(422);
    expect((await record(world, { photoId: 5 })).status).toBe(422);
    expect((await record(world, { photoId: null })).status).toBe(201);
    const ghost = await record(world, {
      photoId: "aaaaaaaa-0000-4000-8000-0000000000aa",
      clientRequestId: "req-2",
    });
    expect([ghost.status, ghost.json.error.code]).toEqual([404, "PhotoNotFound"]);
  });

  it("POST maps the photo failures: 409 PhotoNotUploaded, 422 InvalidPhoto, 422 PhotoNotAllowedOnMissed", async () => {
    const world = await givenActiveSeason(MINUTES);
    const reserved = await reserve(world, 64);
    const notUploaded = await record(world, { photoId: reserved.json.data.photoId });
    expect([notUploaded.status, notUploaded.json.error.code]).toEqual([409, "PhotoNotUploaded"]);

    const png = await reserve(world, 64);
    world.app.evidence.upload(
      {
        url: png.json.data.upload.url,
        method: "PUT",
        headers: png.json.data.upload.headers,
        expiresAt: Date.parse(png.json.data.upload.expiresAt) as never,
      },
      new Uint8Array(64),
    );
    const notJpeg = await record(world, {
      photoId: png.json.data.photoId,
      clientRequestId: "req-2",
    });
    expect([notJpeg.status, notJpeg.json.error.code, notJpeg.json.error.details]).toEqual([
      422,
      "InvalidPhoto",
      { reason: "notJpeg" },
    ]);

    const missed = await record(world, {
      value: { kind: "missed" },
      photoId: reserved.json.data.photoId,
      clientRequestId: "req-3",
    });
    expect([missed.status, missed.json.error.code]).toEqual([422, "PhotoNotAllowedOnMissed"]);
  });

  describe("PUT /entries/:entryId", () => {
    const edit = (world: World, entryId: string, body: object) =>
      world.call("PUT", `/entries/${entryId}`, "andrea", {
        value: { kind: "quantity", value: "30" },
        note: null,
        ...body,
      });

    async function withPhoto() {
      const world = await givenActiveSeason(MINUTES);
      const photoId = await uploaded(world);
      const recorded = await record(world, { photoId });
      return { world, photoId, entryId: recorded.json.data.entry.id as string };
    }

    it("omitting photoId keeps the photo (an old cached client does not send it)", async () => {
      const { world, photoId, entryId } = await withPhoto();
      const { status, json } = await edit(world, entryId, { note: "changed" });
      expect([status, json.data.entry.photoId]).toEqual([200, photoId]);
      expect(world.app.evidence.keys()).toHaveLength(1);
    });

    it("null removes the photo and deletes the file", async () => {
      const { world, entryId } = await withPhoto();
      const { status, json } = await edit(world, entryId, { photoId: null });
      expect([status, json.data.entry.photoId]).toEqual([200, null]);
      expect(world.app.evidence.keys()).toEqual([]);
    });

    it("a new id replaces the photo", async () => {
      const { world, photoId, entryId } = await withPhoto();
      const next = await uploaded(world, 2048);
      const { status, json } = await edit(world, entryId, { photoId: next });
      expect([status, json.data.entry.photoId]).toEqual([200, next]);
      expect(json.data.entry.photoId).not.toBe(photoId);
      expect(world.app.evidence.keys()).toHaveLength(1);
    });

    it("rejects a photoId that is not a uuid or null with 422", async () => {
      const { world, entryId } = await withPhoto();
      expect((await edit(world, entryId, { photoId: "x" })).status).toBe(422);
      expect((await edit(world, entryId, { photoId: 3 })).status).toBe(422);
    });

    it("a new photo on a missed edit is 422 PhotoNotAllowedOnMissed", async () => {
      const { world, entryId } = await withPhoto();
      const next = await uploaded(world, 2048);
      const { status, json } = await edit(world, entryId, {
        value: { kind: "missed" },
        photoId: next,
      });
      expect([status, json.error.code]).toEqual([422, "PhotoNotAllowedOnMissed"]);
    });

    it("DELETE removes the photo with the entry", async () => {
      const { world, entryId } = await withPhoto();
      expect((await world.call("DELETE", `/entries/${entryId}`, "andrea")).status).toBe(200);
      expect(world.app.evidence.keys()).toEqual([]);
    });
  });
});

describe("Today and progress carry the photo", () => {
  it("GET /me/today gives the owner { photoId, url, expiresAt }; GET progress gives a peer only { url, expiresAt }", async () => {
    const world = await givenTwoMemberSeason(MINUTES);
    const reserved = await world.call(
      "POST",
      `/seasons/${world.seasonId}/commitments/${world.commitmentIds.andrea}/photos`,
      "andrea",
      { byteSize: 4096, contentType: "image/jpeg" },
    );
    expect(upload(world, reserved.json.data, 4096)).toBe("accepted");
    const photoId = reserved.json.data.photoId;
    const recorded = await world.call("POST", world.path, "andrea", {
      commitmentId: world.commitmentIds.andrea,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "req-1",
      photoId,
    });
    expect(recorded.status).toBe(201);

    const mine = await world.call("GET", "/me/today", "andrea");
    const entries = mine.json.data.rows.flatMap((r: { entries: unknown[] }) => r.entries) as {
      photo: Record<string, unknown> | null;
    }[];
    const photo = entries.find((e) => e.photo)?.photo;
    expect(Object.keys(photo ?? {}).sort()).toEqual(["expiresAt", "photoId", "url"]);
    expect(photo?.photoId).toBe(photoId);

    const peer = await world.call(
      "GET",
      `/seasons/${world.seasonId}/commitments/${world.commitmentIds.andrea}/progress`,
      "victor",
    );
    expect(peer.status).toBe(200);
    const evidence = peer.json.data.weeks.flatMap((w: { cells: { evidence: unknown[] }[] }) =>
      w.cells.flatMap((c) => c.evidence),
    ) as { photo: Record<string, unknown> | null }[];
    const seen = evidence.find((e) => e.photo)?.photo;
    expect(Object.keys(seen ?? {}).sort()).toEqual(["expiresAt", "url"]);
    expect(JSON.stringify(peer.json)).not.toContain(photoId);
  });
});

describe("storage failures", () => {
  it("an unavailable storage is a 503 with Retry-After; a rejected or unauthorized one is a 500 with no detail", () => {
    const map = createThrownMapper();
    const storageError = (code: string) =>
      Object.assign(new Error(`Evidence storage failed: ${code}`), {
        name: "EvidenceStorageError",
        code,
      });
    expect(map(storageError("unavailable"), { requestId: "r" })).toMatchObject({
      status: 503,
      error: { code: "ServiceUnavailable" },
      headers: { "Retry-After": "5" },
    });
    for (const code of ["rejected", "unauthorized"]) {
      const result = map(storageError(code), { requestId: "r" });
      expect(result).toMatchObject({ status: 500, error: { code: "Internal" } });
      expect(JSON.stringify(result)).not.toContain(code);
    }
  });
});
