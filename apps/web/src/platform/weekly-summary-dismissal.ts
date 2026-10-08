import type { DeviceKey } from "../ports/device-store.ts";

/** A flag only: no summary, habit metadata or server response is stored on the device. */
export function weeklySummaryDismissalKey(
  memberId: string,
  seasonId: string,
  weekIndex: number,
): DeviceKey {
  return `weekly-summary-seen:${encodeURIComponent(memberId)}:${encodeURIComponent(seasonId)}:${weekIndex}`;
}
