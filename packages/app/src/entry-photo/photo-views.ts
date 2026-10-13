import type { EvidenceStorage } from "../ports/evidence-storage.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { EntryPhotoId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import { DOWNLOAD_URL_TTL_SECONDS } from "./limits.ts";

/** What a reader receives for a photo: a short-lived signed download, nothing about the object. */
export interface PhotoView {
  readonly url: string;
  readonly expiresAt: Instant;
}

/**
 * Signed download URLs for `ids` (REQ-P3..P6). The caller has ALREADY filtered the ids by
 * `visiblePhotoId`, so nothing is signed for a photo the viewer may not see (REQ-P4). Only
 * `attached` rows are signed: a pending, released or unknown id gets no entry, so an unattached
 * upload is never readable by anyone (REQ-P6). Reads only: it never writes (REQ-P5), and with no
 * ids it does not touch storage.
 */
export async function photoViews(
  repos: Repositories,
  storage: EvidenceStorage,
  ids: readonly EntryPhotoId[],
  now: Instant,
): Promise<ReadonlyMap<EntryPhotoId, PhotoView>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = (await repos.entryPhotos.getMany(wanted)).filter((row) => row.status === "attached");
  if (rows.length === 0) {
    return new Map();
  }
  const signed = await storage.signDownloads(
    rows.map((row) => row.objectKey),
    DOWNLOAD_URL_TTL_SECONDS,
    now,
  );
  const views = new Map<EntryPhotoId, PhotoView>();
  for (const row of rows) {
    const request = signed.get(row.objectKey);
    if (request) {
      views.set(row.id, { url: request.url, expiresAt: request.expiresAt });
    }
  }
  return views;
}
