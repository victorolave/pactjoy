import type { TodayView } from "@pactjoy/app";

/**
 * The Today view passes through verbatim, like the score views: the app already
 * holds only JSON-safe values (decimals as strings, LocalDates as "YYYY-MM-DD",
 * plain numbers for percentages), carries `viewerId` (a MemberId) and never a
 * `userId`, and lists only the viewer's own commitments (TD-R8). Kept as a named
 * function so a controller never returns a domain value without a presenter.
 */
export function presentToday(view: TodayView): TodayView {
  return view;
}
