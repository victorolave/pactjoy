import type { TodayView } from "@pactjoy/app";
import { longDate } from "../../shared/format.ts";

type Seasoned = Extract<TodayView, { state: "pactOpen" | "notStarted" | "active" | "ended" }>;
type Running = Extract<TodayView, { state: "active" | "ended" }>;

/** What the Today screen renders, derived once from the server's view. Pure. */
export type TodayModel =
  | { readonly kind: "noCircle" }
  | { readonly kind: "noSeason"; readonly circleName: string }
  | {
      readonly kind: "pactOpen" | "notStarted";
      readonly circleName: string;
      readonly lengthWeeks: number;
      /** ISO local date the season starts (or is meant to start). */
      readonly startDate: string;
    }
  | {
      readonly kind: "active" | "ended";
      /** The viewer's per-circle display name, or null when the standings do not list them. */
      readonly greetingName: string | null;
      readonly dateLabel: string;
      readonly weekLabel: string;
      readonly rows: Running["rows"];
    };

const seasonOf = (view: Seasoned) => ({
  circleName: view.circle.name,
  lengthWeeks: view.season.lengthWeeks,
  startDate: view.season.actualStart ?? view.season.nominalStart,
});

export function toTodayModel(view: TodayView): TodayModel {
  switch (view.state) {
    case "noCircle":
      return { kind: "noCircle" };
    case "noSeason":
      return { kind: "noSeason", circleName: view.circle.name };
    case "pactOpen":
    case "notStarted":
      return { kind: view.state, ...seasonOf(view) };
    case "active":
    case "ended":
      return {
        kind: view.state,
        greetingName:
          view.standings.rows.find((row) => row.memberId === view.viewerId)?.displayName ?? null,
        dateLabel: longDate(view.today),
        weekLabel: `Semana ${view.summary.week} de ${view.summary.weekCount}`,
        rows: view.rows,
      };
  }
}
