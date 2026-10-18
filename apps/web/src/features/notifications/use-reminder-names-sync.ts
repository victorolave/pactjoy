import type { TodayView } from "@pactjoy/app";
import { useEffect, useMemo } from "react";
import { useReminderNames } from "../../context/reminder-names-context.tsx";
import type { NamedCommitment } from "../../ports/reminder-names.ts";
import { encodeReminderNames } from "../../sw/reminder-names.ts";

/**
 * Leaves the names of the viewer's own commitments on the device for reminder pushes (D2): the
 * VISIBLE ones only, so a private habit is never named on the lock screen. Today's
 * rows are the viewer's own by construction. Written again only when the names change.
 */
export function useReminderNamesSync(view: TodayView | undefined): void {
  const names = useReminderNames();
  const commitments = useMemo<readonly NamedCommitment[] | null>(() => {
    if (view === undefined) return null;
    // No running season: nothing can be reminded, so no name stays behind (fail closed).
    if (view.state !== "active" && view.state !== "ended") return [];
    // A private name never even reaches the port (which drops it too).
    return view.rows
      .filter((row) => row.privacy === "visible")
      .map((row) => ({
        commitmentId: row.commitmentId,
        habitName: row.habitName,
        privacy: row.privacy,
      }));
  }, [view]);
  const stored = commitments === null ? null : encodeReminderNames(commitments);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stored` is the change signal
  useEffect(() => {
    if (commitments !== null) void names.save(commitments);
  }, [names, stored]);
}
