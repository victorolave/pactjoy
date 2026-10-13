import type { Actor } from "@pactjoy/app";
import { addDays, type SeedContext, seedSeason } from "../core.ts";
import type { Scenario } from "../scenario.ts";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;
const TUE_THU_SAT = [1, 3, 5] as const;
/** The season starts this many days after the real "today", so the pact stays open until then. */
const START_IN_DAYS = 3;

/**
 * Pair circle whose pact is still OPEN (design 8-12b, 13, 14a): both members filled their
 * commitments (every kind of measure, one private) and the season is planned to start in a few
 * days. Victor has approved and Andrea has not, so:
 * - as Andrea you land on the pact review (12a, "Aprobar el pacto") and can edit commitments and
 *   weights first (screens 8-11; any edit resets the approvals);
 * - as Victor you see the waiting screen (12b, "Esperando a Andrea") and can withdraw;
 * - when Andrea approves the pact closes (14a), and the optional baseline SRBAI offer (13)
 *   shows on that screen.
 */
export const pairPactOpen: Scenario = {
  id: "pair-pact-open",
  summary: "Pair, pact open: Victor approved, Andrea has not (screens 8-13)",
  accounts: [
    { email: "andrea.pacto@pactjoy.local", displayName: "Andrea" },
    { email: "victor.pacto@pactjoy.local", displayName: "Victor" },
  ],
  async run(seed: SeedContext, [andrea, victor]: readonly Actor[], today: string) {
    if (andrea === undefined || victor === undefined) throw new Error("pair needs two accounts");
    const start = addDays(today, START_IN_DAYS);
    const andreaMember = {
      actor: andrea,
      displayName: "Andrea",
      commitments: [
        {
          key: "leer",
          habit: "Leer",
          icon: "book",
          weightPercent: 30,
          measure: {
            unit: "minutes",
            direction: "reach",
            minimum: "10",
            ideal: "30",
            schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
          },
        },
        {
          key: "meditar",
          habit: "Meditar",
          icon: "flower",
          weightPercent: 20,
          measure: { unit: "done", frequency: { kind: "specificDays", weekdays: EVERY_DAY } },
        },
        {
          key: "ingles",
          habit: "Inglés",
          icon: "brain",
          weightPercent: 25,
          measure: {
            unit: "minutes",
            direction: "reach",
            minimum: "60",
            ideal: "150",
            schedule: { period: "weeklyTotal" },
          },
        },
        {
          key: "cafe",
          habit: "Máximo 1 café al día",
          icon: "coffee",
          weightPercent: 25,
          measure: {
            unit: "times",
            direction: "limit",
            ideal: "1",
            tolerance: "3",
            schedule: {
              period: "perSession",
              frequency: { kind: "specificDays", weekdays: EVERY_DAY },
            },
          },
        },
      ],
    } as const;
    const victorMember = {
      actor: victor,
      displayName: "Victor",
      commitments: [
        {
          key: "gym",
          habit: "Gym",
          icon: "dumbbell",
          weightPercent: 40,
          measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
        },
        {
          key: "dibujar",
          habit: "Dibujar",
          icon: "palette",
          weightPercent: 30,
          measure: { unit: "done", frequency: { kind: "specificDays", weekdays: TUE_THU_SAT } },
        },
        {
          key: "diario",
          habit: "Diario",
          icon: "pencil",
          weightPercent: 30,
          privacy: "private",
          measure: {
            unit: "minutes",
            direction: "reach",
            minimum: "5",
            ideal: "15",
            schedule: {
              period: "perSession",
              frequency: { kind: "specificDays", weekdays: EVERY_DAY },
            },
          },
        },
      ],
    } as const;
    const season = await seedSeason({
      seed,
      circleName: "Andrea y Victor (pacto)",
      createdOn: today,
      startDate: start,
      lengthWeeks: 4,
      members: [andreaMember, victorMember],
      approvals: [victorMember],
    });
    seed.log(
      `pair-pact-open: season ${season.seasonId} planned to start ${start}; Victor approved, Andrea has not.`,
    );
  },
};
