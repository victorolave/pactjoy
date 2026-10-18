/**
 * The public API of the entry feature: what Today needs to register, undo and edit a row's entries.
 * Everything else under `features/entry` is internal, and other features never import it.
 */
export { useUndoEntry } from "./feedback/use-undo-entry.ts";
export { CheckCircle } from "./one-tap/CheckCircle.tsx";
export { useOneTap } from "./one-tap/use-one-tap.ts";
export { noticeLine, noticeTitle } from "./outbox/notices.ts";
export type { Outbox } from "./outbox/outbox.ts";
export {
  NO_MARKS,
  overlayToday,
  PENDING_BADGE,
  PENDING_FOOTNOTE,
  type PendingKind,
  type PendingMarks,
  pendingLine,
} from "./outbox/overlay.ts";
export {
  OutboxProvider,
  useOutbox,
  useOutboxReplaying,
  useOutboxState,
  useOverlayToday,
} from "./outbox/use-outbox.tsx";
export { EntrySheetHost } from "./sheet/EntrySheetHost.tsx";
export { limitMeasureOf, quantityMeasureOf } from "./sheet/entry-form.ts";
export { useEntrySheet } from "./sheet/use-entry-sheet.ts";
