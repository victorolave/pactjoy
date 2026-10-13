import type { CommitmentId } from "@pactjoy/engine";
import { findActiveMember } from "../circle/circle.ts";
import type { EvidenceStorage, SignedRequest } from "../ports/evidence-storage.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { RandomSource } from "../ports/random-source.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { type EntryPhotoId, entryPhotoId, type SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { Instant } from "../time/instant.ts";
import { pendingEntryPhoto } from "./entry-photo.ts";
import type { PhotoError } from "./errors.ts";
import {
  MAX_OPEN_UPLOADS,
  MAX_PHOTO_BYTES,
  SWEEP_BATCH,
  UPLOAD_URL_TTL_SECONDS,
} from "./limits.ts";
import { mintObjectKey } from "./object-key.ts";
import { sweepEntryPhotos } from "./sweep-entry-photos.ts";

export interface RequestEntryPhotoUploadDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
  readonly evidence: EvidenceStorage;
}

export interface RequestEntryPhotoUploadInput {
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
  /** The exact size of the JPEG the browser will PUT: the signature pins it. */
  readonly byteSize: number;
  readonly contentType: string;
}

export type RequestEntryPhotoUploadError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "CommitmentNotOwned" }
  | { readonly kind: "SeasonNotActive" }
  | Extract<PhotoError, { kind: "InvalidPhoto" | "TooManyPhotoUploads" }>;

export interface RequestEntryPhotoUploadResult {
  readonly photoId: EntryPhotoId;
  /** The one direct PUT the browser may make. Nothing else about the object leaves the server. */
  readonly upload: SignedRequest;
  /** Until when the photo can still be attached to an Entry. */
  readonly attachBy: Instant;
}

interface Reserved {
  readonly photoId: EntryPhotoId;
  readonly attachBy: Instant;
  readonly objectKey: string;
}

/**
 * Reserves one upload slot (REQ-U1..U7): checks only that the actor is an active member who owns
 * the commitment of an active season and holds fewer than {@link MAX_OPEN_UPLOADS} open
 * reservations. It deliberately does NOT look at the entry window, pauses or any day: those need a
 * `forDate` the reservation does not have, and `recordEntry` / `editEntry` are the gate (a reservation
 * for a closed window just expires unused).
 *
 * Before reserving it lazily cleans the actor's stale rows (bounded by {@link SWEEP_BATCH}, errors
 * swallowed), so nobody needs a job for the cap to stay honest. The signed URL is minted after the
 * commit: signing is pure computation, and a failure there leaves a pending row that expires.
 */
export async function requestEntryPhotoUpload(
  deps: RequestEntryPhotoUploadDeps,
  actor: Actor,
  input: RequestEntryPhotoUploadInput,
): Promise<Result<RequestEntryPhotoUploadResult, RequestEntryPhotoUploadError>> {
  if (input.contentType !== "image/jpeg") {
    return err({ kind: "InvalidPhoto", reason: "type" });
  }
  if (!Number.isInteger(input.byteSize) || input.byteSize < 1) {
    return err({ kind: "InvalidPhoto", reason: "empty" });
  }
  if (input.byteSize > MAX_PHOTO_BYTES) {
    return err({ kind: "InvalidPhoto", reason: "tooLarge" });
  }

  // Who the actor is in this season's circle, to scope the cleanup to their own rows.
  const memberId = await deps.uow.read(async (repos) => {
    const season = await repos.seasons.get(input.seasonId);
    const circle = season ? await repos.circles.get(season.circleId) : null;
    return circle ? (findActiveMember(circle, actor.userId)?.id ?? null) : null;
  });
  if (memberId !== null) {
    try {
      await sweepEntryPhotos(deps, { memberId, limit: SWEEP_BATCH });
    } catch {
      // Best effort: whatever it could not clean waits for the next request or for job D.
    }
  }

  const now = deps.clock.now();
  const reserved = await deps.uow.transaction(
    async (repos): Promise<Result<Reserved, RequestEntryPhotoUploadError>> => {
      const season = await repos.seasons.get(input.seasonId);
      if (!season) {
        return err({ kind: "SeasonNotFound" });
      }
      const circle = await repos.circles.get(season.circleId);
      const member = circle ? findActiveMember(circle, actor.userId) : undefined;
      if (!circle || !member) {
        return err({ kind: "NotAMember" });
      }
      const commitment = season.commitments.find(
        (candidate) => candidate.id === input.commitmentId && candidate.memberId === member.id,
      );
      if (!commitment) {
        return err({ kind: "CommitmentNotOwned" });
      }
      if (season.status !== "active" || season.actualStart === null) {
        return err({ kind: "SeasonNotActive" });
      }
      if ((await repos.entryPhotos.countOpen(member.id, now)) >= MAX_OPEN_UPLOADS) {
        return err({ kind: "TooManyPhotoUploads" });
      }
      const photo = pendingEntryPhoto({
        id: entryPhotoId(deps.ids.next()),
        seasonId: season.id,
        memberId: member.id,
        commitmentId: commitment.id,
        objectKey: mintObjectKey(deps.random),
        byteSize: input.byteSize,
        now,
      });
      await repos.entryPhotos.add(photo);
      return ok({ photoId: photo.id, attachBy: photo.attachBy, objectKey: photo.objectKey });
    },
  );
  if (!reserved.ok) {
    return reserved;
  }

  const upload = await deps.evidence.signUpload(
    reserved.value.objectKey,
    { size: input.byteSize, contentType: "image/jpeg" },
    UPLOAD_URL_TTL_SECONDS,
    now,
  );
  return ok({ photoId: reserved.value.photoId, upload, attachBy: reserved.value.attachBy });
}
