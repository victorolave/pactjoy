import type { Actor } from "@pactjoy/app";
import {
  addDays,
  type PlannedEntry,
  recordPlan,
  type SeedContext,
  seedSeason,
  weekdayOf,
} from "../core.ts";
import type { Scenario } from "../scenario.ts";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;
const TUE_THU_SAT = [1, 3, 5] as const;

/**
 * Pair circle, week 3 of 8 (design 23a, 23d, 24a, 24b, Today): weeks 1–2 are closed (a good one,
 * then a difficult one under 50 % consistency), week 3 is on its third day. Andrea covers every
 * kind of measure (timesPerWeek, specificDays done, weeklyTotal, limit) plus a missed day, a
 * below-minimum session, a note, a late registro and a running streak; Victor has a private
 * commitment, so Andrea sees it only as "Objetivo privado".
 */
export const pairWeek3: Scenario = {
  id: "pair",
  summary: "Pair, week 3 of 8: weeks 1-2 closed (good / difficult), every kind of habit",
  accounts: [
    { email: "andrea@pactjoy.local", displayName: "Andrea" },
    { email: "victor@pactjoy.local", displayName: "Victor" },
  ],
  async run(seed: SeedContext, [andrea, victor]: readonly Actor[], today: string) {
    if (andrea === undefined || victor === undefined) throw new Error("pair needs two accounts");
    const start = addDays(today, -16);
    const season = await seedSeason({
      seed,
      circleName: "Andrea y Victor",
      createdOn: addDays(start, -1),
      startDate: start,
      lengthWeeks: 8,
      members: [
        {
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
        },
        {
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
        },
      ],
    });
    await recordPlan(seed, season, pairPlan(start));
    seed.log(`pair: season ${season.seasonId} started ${start}; today is day 17 (week 3, day 3).`);
  },
};

const minutes = (value: number) => ({ kind: "quantity", value: String(value) }) as const;
const DONE = { kind: "done" } as const;

/** The registros of days 0–15 (day 16 is today: left for the device). */
export function pairPlan(start: string): PlannedEntry[] {
  const d = (n: number) => addDays(start, n);
  const plan: PlannedEntry[] = [];
  const add = (n: number, key: string, value: PlannedEntry["value"], extra = {}) =>
    plan.push({ day: d(n), key, value, ...extra });

  // Week 1 (days 0–6): a good week.
  add(0, "leer", minutes(30));
  add(2, "leer", minutes(30), { note: "Capítulo 3" });
  add(4, "leer", minutes(20));
  for (let n = 0; n <= 6; n++) add(n, "meditar", DONE, n === 3 ? { lateBy: 1 } : {});
  add(1, "ingles", minutes(60));
  add(5, "ingles", minutes(90));
  for (let n = 0; n <= 6; n++) add(n, "cafe", minutes(1));

  // Week 2 (days 7–13): a difficult one (under 50 % consistency).
  add(8, "leer", minutes(5)); // below the minimum
  add(7, "meditar", DONE);
  add(9, "meditar", { kind: "missed" }); // "Hoy no salió"
  add(10, "ingles", minutes(30)); // weekly total under its minimum
  add(7, "cafe", minutes(4)); // over the tolerance
  add(8, "cafe", minutes(4));

  // Week 3 so far (days 14–15): the streak starts again.
  add(14, "meditar", DONE);
  add(15, "meditar", DONE);
  add(14, "leer", minutes(25));
  add(15, "cafe", minutes(2));

  // Victor.
  for (const n of [0, 2, 4, 8, 15]) add(n, "gym", DONE);
  const dibujar = [...Array(14).keys()].filter((n) => TUE_THU_SAT.includes(weekdayOf(d(n)) as 1));
  for (const n of [...dibujar.filter((n) => n <= 6), ...dibujar.filter((n) => n > 6).slice(0, 1)]) {
    add(n, "dibujar", DONE);
  }
  for (let n = 0; n <= 12; n++) if (n !== 5 && n !== 11) add(n, "diario", minutes(10));
  return plan;
}
