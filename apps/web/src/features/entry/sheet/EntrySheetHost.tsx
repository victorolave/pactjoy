import type { PendingYesterdayItem, TodayRow } from "@pactjoy/app";
import { EditSheet } from "../edit/EditSheet.tsx";
import { EntrySheet } from "./EntrySheet.tsx";
import { useEntrySheet } from "./use-entry-sheet.ts";

/** Renders the sheet the URL asks for, if that commitment is in Today: edit an entry, or add one. */
export function EntrySheetHost({
  rows,
  seasonId,
  pendingYesterday = [],
}: {
  readonly rows: readonly TodayRow[];
  readonly seasonId: string;
  readonly pendingYesterday?: readonly PendingYesterdayItem[];
}) {
  const { commitmentId, entryId, forYesterday, select, close } = useEntrySheet();
  const row = rows.find((candidate) => candidate.commitmentId === commitmentId);
  if (row === undefined) return null;
  const entry = row.entries.find((candidate) => candidate.entryId === entryId);
  if (entry !== undefined) {
    return <EditSheet row={row} entry={entry} onSelect={select} onClose={close} />;
  }
  const pending = pendingYesterday.find((item) => item.commitmentId === row.commitmentId);
  return (
    <EntrySheet
      key={row.commitmentId}
      row={row}
      seasonId={seasonId}
      pending={pending}
      startOnYesterday={forYesterday}
      onClose={close}
    />
  );
}
