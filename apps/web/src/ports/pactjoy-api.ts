import type { TodayView } from "@pactjoy/app";

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

/** Everything the screens know about the backend. Adapters throw `ApiError`. */
export interface PactJoyApi {
  getToday(signal?: AbortSignal): Promise<TodayView>;
  recordEntry(cmd: RecordEntryCommand): Promise<RecordedEntry>;
  editEntry(cmd: EditEntryCommand): Promise<void>;
  deleteEntry(entryId: string): Promise<void>;
}
