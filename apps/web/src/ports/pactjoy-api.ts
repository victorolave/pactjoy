import type { InvitePreview, MyCircleView, TodayView } from "@pactjoy/app";
import type { Serialized } from "./wire.ts";

export type EntryValueInput =
  | { readonly kind: "done" }
  | { readonly kind: "missed" }
  | { readonly kind: "quantity"; readonly value: string };

export interface RecordEntryCommand {
  readonly seasonId: string;
  readonly commitmentId: string;
  readonly forDate?: string;
  readonly value: EntryValueInput;
  readonly note: string | null;
  /** The idempotency key. Reuse it when retrying the same user action. */
  readonly clientRequestId: string;
}

export interface EditEntryCommand {
  readonly entryId: string;
  readonly value: EntryValueInput;
  readonly note: string | null;
}

/** A local wire type: the API returns the whole entry, the client needs only these two fields. */
export interface RecordedEntry {
  readonly entryId: string;
  readonly replayed: boolean;
}

/** The Circle tab's read model as it arrives over the wire (`GET /me/circle`). */
export type MyCircle = Serialized<MyCircleView>;
/** The circle's current invite; `expiresAt` is compared with the client clock, never trusted as a flag. */
export type CircleInvite = NonNullable<NonNullable<MyCircle["circle"]>["invite"]>;
/** What a code leads to, before joining (`POST /circles/join/preview`). */
export type InvitePreviewView = Serialized<InvitePreview>;

/** Create and join return the whole circle; the client keeps only the id and refetches `getMyCircle`. */
export interface CircleRef {
  readonly circleId: string;
}

export interface CreateCircleCommand {
  readonly name: string;
  readonly displayName: string;
}

export interface JoinCircleCommand {
  readonly inviteCode: string;
  readonly displayName: string;
}

/** Everything the screens know about the backend. Adapters throw `ApiError`. */
export interface PactJoyApi {
  getToday(signal?: AbortSignal): Promise<TodayView>;
  recordEntry(cmd: RecordEntryCommand): Promise<RecordedEntry>;
  editEntry(cmd: EditEntryCommand): Promise<void>;
  deleteEntry(entryId: string): Promise<void>;
  getMyCircle(signal?: AbortSignal): Promise<MyCircle>;
  /** Read-only: the same errors as `joinCircle`, so a preview that works predicts the join. */
  previewInvite(inviteCode: string, signal?: AbortSignal): Promise<InvitePreviewView>;
  createCircle(cmd: CreateCircleCommand): Promise<CircleRef>;
  joinCircle(cmd: JoinCircleCommand): Promise<CircleRef>;
  generateInvite(circleId: string): Promise<CircleInvite>;
  renameCircle(circleId: string, name: string): Promise<void>;
  renameMyDisplayName(circleId: string, displayName: string): Promise<void>;
  leaveCircle(circleId: string): Promise<void>;
}
