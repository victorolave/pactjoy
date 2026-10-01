import type { MemberScoreView, StandingsView } from "@pactjoy/app";

/**
 * Score views pass through verbatim: the app already projects privacy per
 * viewer and holds display numbers, decimal-string thresholds and plain
 * streaks (no BigInt). Kept as named functions so controllers never return a
 * domain value without going through a presenter.
 */
export function presentMemberScore(view: MemberScoreView): MemberScoreView {
  return view;
}

export function presentStandings(view: StandingsView): StandingsView {
  return view;
}
