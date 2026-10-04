import { useState } from "react";

/**
 * Points a sheet's save added to its opportunity: what the row's `earned` says now (the server's,
 * once Today is refetched) minus what it said when the sheet opened. `null` while nothing is
 * gained, which includes the moment before the refetch lands.
 */
export function useEarnedGain(earned: number | null): number | null {
  const [before] = useState(earned ?? 0);
  const gain = (earned ?? 0) - before;
  return gain > 0 ? gain : null;
}
