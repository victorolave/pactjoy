import type { SignedRequest } from "../ports/evidence-storage.ts";
import type { Actor } from "../shared/actor.ts";
import type { EntryPhotoId } from "../shared/ids.ts";
import type { TestApp } from "../testing/app-harness.ts";
import type { ActiveSeasonFixture } from "../testing/entry-fixtures.ts";
import { requestEntryPhotoUpload } from "./request-entry-photo-upload.ts";

/** GIVEN-state helpers for the photo tests. They go through the use cases, not the repositories. */

/** The bytes of a JPEG as far as the server looks: the `FF D8 FF` signature, then filler. */
export function jpegBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
}

export interface ReservedPhoto {
  readonly photoId: EntryPhotoId;
  readonly upload: SignedRequest;
  readonly size: number;
}

/** Reserves an upload slot for `actor` on `commitment`; throws if the use case refuses. */
export async function reservePhoto(
  app: TestApp,
  actor: Actor,
  given: Pick<ActiveSeasonFixture, "season">,
  commitment: ActiveSeasonFixture["andreaCommitment"],
  size = 2048,
): Promise<ReservedPhoto> {
  const reserved = await requestEntryPhotoUpload(app, actor, {
    seasonId: given.season.id,
    commitmentId: commitment,
    byteSize: size,
    contentType: "image/jpeg",
  });
  if (!reserved.ok) throw new Error(`setup: reserve failed with ${reserved.error.kind}`);
  return { photoId: reserved.value.photoId, upload: reserved.value.upload, size };
}

/** Reserves a slot and plays the browser: PUTs `bytes` (a valid JPEG of the reserved size by default). */
export async function uploadedPhoto(
  app: TestApp,
  actor: Actor,
  given: Pick<ActiveSeasonFixture, "season">,
  commitment: ActiveSeasonFixture["andreaCommitment"],
  size = 2048,
): Promise<ReservedPhoto> {
  const reserved = await reservePhoto(app, actor, given, commitment, size);
  if (app.evidence.upload(reserved.upload, jpegBytes(size)) !== "accepted") {
    throw new Error("setup: the fake storage refused the upload");
  }
  return reserved;
}
