import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import type { BadgeTone } from "../../../ui/Badge.tsx";

type Season = NonNullable<MyCircle["season"]>;

export interface SeasonStatus {
  /** The pact badge. */
  readonly badge: string;
  readonly tone: BadgeTone;
  /** The line next to it, or `null` when there is nothing to add. */
  readonly detail: string | null;
}

/** The season and pact state of the Circle tab (31a-lite): only what `/me/circle` knows. */
export function seasonStatus(season: Season, memberCount: number): SeasonStatus {
  switch (season.phase) {
    case "pactOpen":
      return {
        badge: "Pacto abierto",
        tone: "pending",
        detail: `${season.approvalCount} de ${memberCount} lo han aprobado`,
      };
    case "notStarted":
      return {
        badge: "Pacto aprobado",
        tone: "success",
        detail: `Temporada de ${season.lengthWeeks} semanas por empezar`,
      };
    case "active":
      return {
        badge: "Pacto activo",
        tone: "success",
        detail: season.week === null ? null : `Semana ${season.week} de ${season.lengthWeeks}`,
      };
    case "ended":
      return { badge: "Temporada terminada", tone: "neutral", detail: null };
  }
}
