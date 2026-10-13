import type { TodayView } from "@pactjoy/app";
import type {
  CarryOverDto,
  SeasonHistoryDto,
  SeasonResultsCommitmentDto,
  SeasonResultsDto,
  SubmittedClosureDto,
} from "../../ports/wire.ts";
import { DIBUJAR, GYM, INGLES, LEER } from "./review.ts";

export { DIBUJAR, GYM, INGLES, LEER };

const commitment = (
  overrides: Pick<SeasonResultsCommitmentDto, "commitmentId" | "habitName"> &
    Partial<SeasonResultsCommitmentDto>,
): SeasonResultsCommitmentDto => ({
  habitId: `habit-${overrides.habitName.toLowerCase()}`,
  icon: null,
  points: 0,
  consistencyPercent: null,
  idealPercent: null,
  automaticity: { from: null, to: null },
  stage: "new",
  ...overrides,
});

/**
 * Screen 36 as designed: Andrea and Victor, 8 weeks (25 ago to 19 oct), 792 points, 85 %
 * consistency and 79 % ideal; Victor is second, 6 points behind Andrea. Leer is the integrated one.
 */
export const resultsFixture = (overrides: Partial<SeasonResultsDto> = {}): SeasonResultsDto => ({
  seasonId: "season-1",
  status: "active",
  lengthWeeks: 8,
  actualStart: "2026-08-25",
  lastDay: "2026-10-19",
  totals: { points: 792, consistencyPercent: 85, idealPercent: 79 },
  standings: { rank: 2, memberCount: 2, gap: { displayName: "Andrea", points: 6 } },
  commitments: [
    commitment({
      commitmentId: LEER,
      habitName: "Leer",
      points: 300,
      consistencyPercent: 88,
      idealPercent: 82,
      automaticity: { from: "3,5", to: "5,8" },
      stage: "integrated",
    }),
    commitment({
      commitmentId: INGLES,
      habitName: "Inglés",
      points: 200,
      consistencyPercent: 80,
      idealPercent: 75,
      automaticity: { from: "2,5", to: "3,8" },
      stage: "developing",
    }),
    commitment({
      commitmentId: DIBUJAR,
      habitName: "Dibujar",
      points: 180,
      consistencyPercent: 90,
      idealPercent: 85,
      automaticity: { from: "3", to: "5" },
      stage: "developing",
    }),
    commitment({
      commitmentId: GYM,
      habitName: "Gym",
      points: 112,
      consistencyPercent: 50,
      idealPercent: 40,
      automaticity: { from: "2", to: "2,8" },
      stage: "new",
    }),
  ],
  closingReviewDone: true,
  closure: null,
  ...overrides,
});

export const submittedClosureFixture = (
  overrides: Partial<SubmittedClosureDto> = {},
): SubmittedClosureDto => ({
  decidedAt: "2026-10-21T15:00:00.000Z",
  decisions: [
    { commitmentId: LEER, decision: "graduate" },
    { commitmentId: INGLES, decision: "continue" },
    { commitmentId: DIBUJAR, decision: "continue" },
    { commitmentId: GYM, decision: "adjust" },
  ],
  graduatedHabitIds: ["habit-leer"],
  seasonClosed: false,
  ...overrides,
});

export const carryOverFixture = (overrides: Partial<CarryOverDto> = {}): CarryOverDto => ({
  previousSeasonId: null,
  items: [],
  ...overrides,
});

export const seasonHistoryFixture = (
  overrides: Partial<SeasonHistoryDto> = {},
): SeasonHistoryDto => ({
  seasons: [
    {
      seasonId: "season-0",
      lengthWeeks: 8,
      actualStart: "2026-08-25",
      lastDay: "2026-10-19",
      points: 792,
      rank: 2,
      memberCount: 2,
      closedByMe: true,
    },
  ],
  ...overrides,
});

type Running = Extract<TodayView, { state: "active" | "ended" }>;
type SeasonCloseDto = NonNullable<Running["seasonClose"]>;

/** What Today carries from the last season day on (C10); the dates are civil dates of the season. */
export const seasonCloseFixture = (
  step: SeasonCloseDto["step"],
  overrides: Partial<SeasonCloseDto> = {},
): SeasonCloseDto => ({
  step,
  resultsFrom: "2026-10-21" as SeasonCloseDto["resultsFrom"],
  nextSeasonFrom: "2026-10-27" as SeasonCloseDto["nextSeasonFrom"],
  nextSeasonOpen: false,
  ...overrides,
});
