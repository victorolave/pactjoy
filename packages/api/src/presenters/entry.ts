import {
  type EditEntryResult,
  type RecordEntryResult,
  type StoredEntry,
  toDecimalString,
} from "@pactjoy/app";
import { presentInstant, presentInstantOrNull } from "./time.ts";

export type EntryValueDto =
  | { readonly kind: "done" }
  | { readonly kind: "missed" }
  | { readonly kind: "quantity"; readonly value: string };

export interface EntryDto {
  readonly id: string;
  readonly seasonId: string;
  readonly commitmentId: string;
  readonly memberId: string;
  readonly day: number;
  readonly recordedOn: number;
  readonly recordedAt: string;
  readonly editedAt: string | null;
  readonly value: EntryValueDto | null;
  readonly note: string | null;
  readonly clientRequestId: string;
  readonly version: number;
  readonly deleted: boolean;
}

/**
 * Never emits `requestFingerprint` (it embeds the value and the note). The
 * note is emitted raw because every entry the API returns is the ACTOR's own
 * (ownership is enforced by the use cases); `visibleNote` becomes mandatory
 * the day an endpoint returns other members' entries (ADR-0011).
 */
export function presentEntry(entry: StoredEntry): EntryDto {
  const value = entry.value;
  return {
    id: entry.id,
    seasonId: entry.seasonId,
    commitmentId: entry.commitmentId,
    memberId: entry.memberId,
    day: entry.day,
    recordedOn: entry.recordedOn,
    recordedAt: presentInstant(entry.recordedAt),
    editedAt: presentInstantOrNull(entry.editedAt),
    value:
      value === null
        ? null
        : value.kind === "quantity"
          ? { kind: "quantity", value: toDecimalString(value.value) }
          : { kind: value.kind },
    note: entry.note,
    clientRequestId: entry.clientRequestId,
    version: entry.version,
    deleted: entry.deleted,
  };
}

export function presentRecordEntryResult(result: RecordEntryResult): {
  readonly entry: EntryDto;
  readonly replayed: boolean;
} {
  return { entry: presentEntry(result.entry), replayed: result.replayed };
}

export function presentEditEntryResult(result: EditEntryResult): { readonly entry: EntryDto } {
  return { entry: presentEntry(result.entry) };
}
