import type { TodayRow } from "@pactjoy/app";
import { EntrySheet } from "./EntrySheet.tsx";
import { useEntrySheet } from "./use-entry-sheet.ts";

/** Renders the sheet the URL asks for, if that commitment is in Today. */
export function EntrySheetHost({ rows }: { readonly rows: readonly TodayRow[] }) {
  const { commitmentId, close } = useEntrySheet();
  const row = rows.find((candidate) => candidate.commitmentId === commitmentId);
  if (row === undefined) return null;
  return <EntrySheet key={row.commitmentId} row={row} onClose={close} />;
}
