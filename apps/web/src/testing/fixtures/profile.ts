import type { ProfileSummaryDto } from "../../ports/wire.ts";

/** The 84 % card of design 39: one season in progress, two habits (one carried, one new). */
export const profileSummaryFixture = (
  overrides: Partial<ProfileSummaryDto> = {},
): ProfileSummaryDto => ({
  consistency: { kept: 21, counted: 25, percent: 84, closedSeasons: 0, inProgress: true },
  habits: [
    {
      habitId: "habit-1",
      name: "Correr",
      icon: "run",
      stage: "developing",
      inCurrentSeason: true,
    },
    {
      habitId: "habit-2",
      name: "Leer",
      icon: null,
      stage: "new",
      inCurrentSeason: true,
    },
  ],
  ...overrides,
});
