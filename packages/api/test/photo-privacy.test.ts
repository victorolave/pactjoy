import type { SignedRequest } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { MINUTES } from "./entries-fixture.ts";
import { setup } from "./harness.ts";

// REQ-P1..P7 / ADR-0016: a photo follows the privacy of its commitment, like the note. Andrea has
// photos on a visible and on a private commitment, one uploaded photo that was never attached and
// one that was released again; Victor reads everything he can. Sentinels are the real object keys
// of the fake storage, so a leak cannot hide behind a changed field name.

const NOTHING_INTERNAL = ["objectKey", "attachBy", "byteSize", "bucket", "uploadId"];

async function world() {
  const ctx = setup();
  const { call, app } = ctx;
  const circle = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const circleId: string = circle.json.data.id;
  const invite = await call("POST", `/circles/${circleId}/invite`, "andrea");
  await call("POST", "/circles/join", "victor", joinCircleBody(invite.json.data.code));
  const season = await call("POST", `/circles/${circleId}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-14",
    lengthWeeks: 4,
  });
  const seasonId: string = season.json.data.id;

  let pactRevision = 0;
  const commit = async (
    who: "andrea" | "victor",
    name: string,
    weight: number,
    privacy: string,
  ) => {
    const habit = await call("POST", "/habits", who, { name });
    const added = await call("POST", `/seasons/${seasonId}/commitments`, who, {
      habitId: habit.json.data.id,
      weightPercent: weight,
      privacy,
      measure: MINUTES,
    });
    pactRevision = added.json.data.pactRevision;
    return added.json.data.commitments.find(
      (c: { habitId?: string }) => c.habitId === habit.json.data.id,
    ).id as string;
  };
  const visible = await commit("andrea", "Leer", 50, "visible");
  const hidden = await commit("andrea", "Diario", 50, "private");
  const victors = await commit("victor", "Correr", 100, "visible");
  for (const who of ["andrea", "victor"]) {
    await call("PUT", `/seasons/${seasonId}/approval`, who, { expectedPactRevision: pactRevision });
  }

  const reserve = async (commitmentId: string) => {
    const reserved = await call(
      "POST",
      `/seasons/${seasonId}/commitments/${commitmentId}/photos`,
      "andrea",
      { byteSize: 2048, contentType: "image/jpeg" },
    );
    expect(reserved.status).toBe(201);
    const photoId: string = reserved.json.data.photoId;
    const bytes = new Uint8Array(2048);
    bytes.set([0xff, 0xd8, 0xff]);
    const up = reserved.json.data.upload;
    const request: SignedRequest = {
      url: up.url,
      method: up.method,
      headers: up.headers,
      expiresAt: Date.parse(up.expiresAt) as never,
    };
    expect(app.evidence.upload(request, bytes)).toBe("accepted");
    const key = app.entryPhotos.all().find((row) => row.id === photoId)?.objectKey ?? "";
    return { photoId, key };
  };
  const record = (commitmentId: string, photoId: string, n: number) =>
    call("POST", `/seasons/${seasonId}/entries`, "andrea", {
      commitmentId,
      value: { kind: "quantity", value: "30" },
      clientRequestId: `req-${n}`,
      photoId,
      note: `nota ${n}`,
    });

  const onVisible = await reserve(visible);
  const onHidden = await reserve(hidden);
  const neverAttached = await reserve(visible);
  const toRelease = await reserve(visible);
  expect((await record(visible, onVisible.photoId, 1)).status).toBe(201);
  expect((await record(hidden, onHidden.photoId, 2)).status).toBe(201);
  const third = await record(visible, toRelease.photoId, 3);
  expect(third.status).toBe(201);
  await call("PUT", `/entries/${third.json.data.entry.id}`, "andrea", {
    value: { kind: "quantity", value: "30" },
    note: "nota 3",
    photoId: null,
  });
  await call("POST", `/seasons/${seasonId}/entries`, "victor", {
    commitmentId: victors,
    value: { kind: "quantity", value: "20" },
    clientRequestId: "victor-1",
  });

  const circleAfter = await app.circles.get(circleId as never);
  const andreaMember = circleAfter?.members.find((m) => m.userId.endsWith("0001"))?.id ?? "";
  return {
    ...ctx,
    circleId,
    seasonId,
    visible,
    hidden,
    andreaMember,
    photos: { onVisible, onHidden, neverAttached, toRelease },
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** Every GET Victor can make that could carry Andrea's evidence. */
const peerReads = (w: World): string[] => [
  `/seasons/${w.seasonId}`,
  `/seasons/${w.seasonId}/progress`,
  `/seasons/${w.seasonId}/members/${w.andreaMember}/progress`,
  `/seasons/${w.seasonId}/commitments/${w.visible}/progress`,
  `/seasons/${w.seasonId}/commitments/${w.hidden}/progress`,
  `/seasons/${w.seasonId}/weeks/0/summary`,
  `/seasons/${w.seasonId}/standings`,
  `/seasons/${w.seasonId}/score`,
  `/seasons/${w.seasonId}/members/${w.andreaMember}/score`,
  `/seasons/${w.seasonId}/results`,
  `/seasons/${w.seasonId}/carry-over`,
  "/me/circle",
  "/me/today",
  "/me/profile",
  "/me/seasons",
  "/me/pause-requests",
];

async function visibleUrl(w: World): Promise<string> {
  const { json } = await w.call(
    "GET",
    `/seasons/${w.seasonId}/commitments/${w.visible}/progress`,
    "victor",
  );
  const evidence = json.data.weeks.flatMap(
    (week: { cells: { evidence: { photo: { url: string } | null }[] }[] }) =>
      week.cells.flatMap((cell) => cell.evidence),
  );
  const url = evidence.find((e: { photo: { url: string } | null }) => e.photo)?.photo?.url;
  if (!url) throw new Error("setup: the visible photo is not in the evidence");
  return url;
}

async function sweepAsVictor(w: World, label: string) {
  const url = await visibleUrl(w);
  const everyPhotoId = Object.values(w.photos).map((p) => p.photoId);
  const secretKeys = [w.photos.onHidden.key, w.photos.neverAttached.key, w.photos.toRelease.key];
  for (const path of peerReads(w)) {
    const { json } = await w.call("GET", path, "victor");
    const text = JSON.stringify(json);
    const where = `${label} GET ${path}`;
    // The one signed URL a peer may hold is the visible photo's; take it out and nothing is left.
    const rest = text.split(url).join("");
    for (const key of secretKeys)
      expect(rest.includes(key), `${where} leaks a private key`).toBe(false);
    expect(
      rest.includes(w.photos.onVisible.key),
      `${where} leaks the visible key outside its URL`,
    ).toBe(false);
    for (const photoId of everyPhotoId)
      expect(text.includes(photoId), `${where} leaks a photo id`).toBe(false);
    expect(rest.includes("entry-photos"), `${where} leaks the bucket or a key path`).toBe(false);
    for (const word of NOTHING_INTERNAL)
      expect(text.includes(word), `${where} has ${word}`).toBe(false);
  }
}

describe("a peer never receives Andrea's private evidence (REQ-P1..P7)", () => {
  it("SC-P1/P2: the owner sees her photos; Victor gets exactly { url, expiresAt } on the visible commitment only", async () => {
    const w = await world();
    const mine = await w.call("GET", "/me/today", "andrea");
    const photos = mine.json.data.rows
      .flatMap((r: { entries: { photo: { photoId: string } | null }[] }) => r.entries)
      .flatMap((e: { photo: { photoId: string } | null }) => (e.photo ? [e.photo.photoId] : []));
    expect(photos.sort()).toEqual([w.photos.onVisible.photoId, w.photos.onHidden.photoId].sort());
    // Neither the never-attached nor the released photo is readable by anyone, owner included.
    expect(JSON.stringify(mine.json)).not.toContain(w.photos.neverAttached.key);
    expect(JSON.stringify(mine.json)).not.toContain(w.photos.toRelease.key);

    const peer = await w.call(
      "GET",
      `/seasons/${w.seasonId}/commitments/${w.visible}/progress`,
      "victor",
    );
    const evidence = peer.json.data.weeks.flatMap(
      (week: { cells: { evidence: { photo: Record<string, unknown> | null }[] }[] }) =>
        week.cells.flatMap((c) => c.evidence),
    ) as { photo: Record<string, unknown> | null }[];
    const withPhoto = evidence.filter((e) => e.photo);
    expect(withPhoto).toHaveLength(1);
    expect(Object.keys(withPhoto[0]?.photo ?? {}).sort()).toEqual(["expiresAt", "url"]);

    const hidden = await w.call(
      "GET",
      `/seasons/${w.seasonId}/commitments/${w.hidden}/progress`,
      "victor",
    );
    expect([hidden.status, hidden.json.error.code]).toEqual([404, "CommitmentNotFound"]);
  });

  it("every peer read is clean: with Andrea in the circle, after she leaves, and after Victor leaves too", async () => {
    const w = await world();
    await sweepAsVictor(w, "both members");
    await w.call("POST", `/circles/${w.circleId}/leave`, "andrea");
    await sweepAsVictor(w, "Andrea left");
    await w.call("POST", `/circles/${w.circleId}/leave`, "victor");
    for (const path of peerReads(w)) {
      const { json } = await w.call("GET", path, "victor");
      const text = JSON.stringify(json);
      for (const key of [
        w.photos.onHidden.key,
        w.photos.neverAttached.key,
        w.photos.toRelease.key,
      ]) {
        expect(text.includes(key), `Victor left, GET ${path}`).toBe(false);
      }
      for (const p of Object.values(w.photos)) expect(text.includes(p.photoId)).toBe(false);
    }
    // Andrea's files stay: leaving a circle never deletes history (REQ-A10). The two attached ones
    // and the uploaded-but-never-attached one (a sweep deletes that one later); the released one is gone.
    expect(w.app.evidence.keys()).toHaveLength(3);
    expect(w.app.evidence.keys()).not.toContain(w.photos.toRelease.key);
  });

  it("SC-P4: a photo that is not yours is a plain 404, whoever it belongs to", async () => {
    const w = await world();
    const stolen = await w.call("POST", `/seasons/${w.seasonId}/entries`, "victor", {
      commitmentId: "aaaaaaaa-0000-4000-8000-0000000000aa",
      value: { kind: "quantity", value: "10" },
      clientRequestId: "victor-2",
      photoId: w.photos.neverAttached.photoId,
    });
    expect([stolen.status, stolen.json.error.code]).toEqual([404, "PhotoNotFound"]);
    expect(JSON.stringify(stolen.json)).not.toContain(w.photos.neverAttached.key);
  });
});
