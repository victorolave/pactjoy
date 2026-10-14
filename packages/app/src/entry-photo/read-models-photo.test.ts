import { describe, expect, it } from "vitest";
import { editEntry } from "../entry/edit-entry.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { commitmentProgress } from "../progress/commitment-progress.query.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { today } from "../today/today.query.ts";
import { DOWNLOAD_URL_TTL_SECONDS } from "./limits.ts";
import { uploadedPhoto } from "./photo-fixtures.ts";

const NOW = localInstant(dayOf(5));

async function setup(privacy: "visible" | "private" = "visible") {
  const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  if (privacy === "private") {
    const season = await app.uow.read(({ seasons }) => seasons.get(given.season.id));
    if (!season) throw new Error("setup");
    await app.seasons.save(
      {
        ...season,
        commitments: season.commitments.map((c) =>
          c.id === given.andreaCommitment ? { ...c, privacy } : c,
        ),
      },
      season.version,
    );
  }
  const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
  const recorded = await recordEntry(app, given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    forDate: dayOf(5),
    value: { kind: "quantity", value: "30" },
    note: "con foto",
    clientRequestId: "req-1",
    photoId: photo.photoId,
  });
  if (!recorded.ok) throw new Error(`setup: ${recorded.error.kind}`);
  const evidenceOf = async (viewer: typeof given.andrea) => {
    const view = await commitmentProgress(app, viewer, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
    });
    if (!view.ok) return view;
    if (view.value.state === "notStarted") throw new Error("setup: not started");
    return {
      ok: true as const,
      evidence: view.value.weeks.flatMap((w) => w.cells.flatMap((c) => c.evidence)),
    };
  };
  return { app, given, photo, entry: recorded.value.entry, evidenceOf };
}

describe("Today and the photo (owner surface)", () => {
  it("TodayEntry.photo carries { photoId, url, expiresAt } for the owner, null without a photo", async () => {
    const { app, given, photo } = await setup();
    const view = await today(app, given.andrea);
    if (view.state !== "active") throw new Error(`state ${view.state}`);
    const entries = view.rows.flatMap((row) => row.entries);
    const withPhoto = entries.find((e) => e.photo !== null);
    expect(withPhoto?.photo).toEqual({
      photoId: photo.photoId,
      url: expect.stringContaining("memory://entry-photos/o/"),
      expiresAt: NOW + DOWNLOAD_URL_TTL_SECONDS * 1000,
    });
    expect(Object.keys(withPhoto?.photo ?? {}).sort()).toEqual(["expiresAt", "photoId", "url"]);
  });

  it("a private commitment's photo is still the owner's to see", async () => {
    const { app, given, photo } = await setup("private");
    const view = await today(app, given.andrea);
    if (view.state !== "active") throw new Error(`state ${view.state}`);
    expect(view.rows.flatMap((r) => r.entries).find((e) => e.photo)?.photo?.photoId).toBe(
      photo.photoId,
    );
  });

  it("the other member's Today has none of Andrea's photos", async () => {
    const { app, given, photo } = await setup();
    const view = await today(app, given.victor);
    expect(JSON.stringify(view)).not.toContain(photo.photoId);
    expect(JSON.stringify(view)).not.toContain("entry-photos");
  });

  it("a removed photo disappears from Today, and reads never write", async () => {
    const { app, given, entry } = await setup();
    await editEntry(app, given.andrea, {
      entryId: entry.id,
      value: { kind: "quantity", value: "30" },
      note: "con foto",
      photoId: null,
    });
    const view = await today(app, given.andrea);
    if (view.state !== "active") throw new Error(`state ${view.state}`);
    expect(view.rows.flatMap((r) => r.entries).every((e) => e.photo === null)).toBe(true);
    const before = JSON.stringify(app.entryPhotos.all());
    await today(app, given.andrea);
    expect(JSON.stringify(app.entryPhotos.all())).toBe(before);
  });

  it("does not sign anything when nobody has a photo", async () => {
    const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await recordEntry(app, given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      forDate: dayOf(5),
      value: { kind: "quantity", value: "30" },
      clientRequestId: "req-1",
    });
    app.evidence.failNext("signDownloads", "unavailable");
    const view = await today(app, given.andrea);
    expect(view.state).toBe("active");
  });
});

describe("commitment progress evidence and the photo", () => {
  it("a peer sees { url, expiresAt } on a visible commitment, never the photo id or the key", async () => {
    const { given, photo, evidenceOf } = await setup();
    const seen = await evidenceOf(given.victor);
    if (!("evidence" in seen)) throw new Error("not readable");
    const withPhoto = seen.evidence.find((e) => e.photo !== null);
    expect(Object.keys(withPhoto?.photo ?? {}).sort()).toEqual(["expiresAt", "url"]);
    expect(withPhoto?.photo?.expiresAt).toBe(NOW + DOWNLOAD_URL_TTL_SECONDS * 1000);
    expect(JSON.stringify(seen)).not.toContain(photo.photoId);
    expect(JSON.stringify(seen)).not.toContain("photoId");
  });

  it("the owner sees it too, on a private commitment as well", async () => {
    const { given, evidenceOf } = await setup("private");
    const mine = await evidenceOf(given.andrea);
    if (!("evidence" in mine)) throw new Error("not readable");
    expect(mine.evidence.some((e) => e.photo !== null)).toBe(true);
  });

  it("a peer cannot read a private commitment at all, so there is no photo to leak", async () => {
    const { given, evidenceOf } = await setup("private");
    expect(await evidenceOf(given.victor)).toEqual({
      ok: false,
      error: { kind: "CommitmentNotFound" },
    });
  });

  it("evidence of an entry without a photo has photo: null", async () => {
    const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await recordEntry(app, given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      forDate: dayOf(5),
      value: { kind: "quantity", value: "30" },
      clientRequestId: "req-1",
    });
    app.evidence.failNext("signDownloads", "unavailable"); // nothing to sign
    const view = await commitmentProgress(app, given.victor, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
    });
    if (!view.ok || view.value.state === "notStarted") throw new Error("setup");
    const evidence = view.value.weeks.flatMap((w) => w.cells.flatMap((c) => c.evidence));
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.photo === null)).toBe(true);
  });
});
