import type { SeasonDay } from "../calendar/season-calendar.ts";
import type { CommitmentId } from "../commitment/commitment.ts";
import type { Fraction } from "../fraction/fraction.ts";

interface EntryBase {
  readonly commitmentId: CommitmentId;
  /** The opportunity day this entry counts toward. */
  readonly day: SeasonDay;
  /** The day the entry was actually recorded — may differ from `day` within the grace period. */
  readonly recordedOn: SeasonDay;
}

/**
 * What a member logs for an opportunity. `missed` is the explicit
 * "Hoy no salió" — like an absent entry, it counts as zero progress, but
 * (unlike an absent entry) it can satisfy the "so far" counting rule (R1)
 * before the grace deadline passes.
 */
export type Entry = EntryBase &
  (
    | { readonly kind: "quantity"; readonly value: Fraction }
    | { readonly kind: "done" }
    | { readonly kind: "missed" }
  );
