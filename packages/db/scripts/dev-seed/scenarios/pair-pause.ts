import type { Actor } from "@pactjoy/app";
import { localDate, requestPause, respondToPause } from "@pactjoy/app";
import {
  addDays,
  must,
  type PlannedEntry,
  recordPlan,
  type SeedContext,
  type SeededSeason,
  seedSeason,
} from "../core.ts";
import type { Scenario } from "../scenario.ts";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;
const TUE_THU_SAT = [1, 3, 5] as const;
/** Season day of the real "today" (week 3, day 3). */
const TODAY_DAY = 16;

const minutes = (value: number) => ({ kind: "quantity", value: String(value) }) as const;
const DONE = { kind: "done" } as const;

/**
 * Pair circle in week 3 of 8 with every pause situation (design 26-30b, ADR-0013). Everything is
 * made through the real use cases at the day it happens, in order:
 * - Andrea's Inglés pause (travel, requested on day 12, Victor approved) runs until TOMORROW, so
 *   Today shows the "ends tomorrow" notice (30a);
 * - Andrea's Meditar pause (health, requested on day 13, open, Victor approved) is running, so
 *   she can resume it (29) and sees "Los puntos se recalcularon" (30b, once per device) for it;
 * - Victor asked TODAY to pause Gym for a week: it stays pending (the 48 h auto-approval has not
 *   fired), so Andrea answers it in Círculo (28) and Victor sees it as pending (27).
 */
export const pairPause: Scenario = {
  id: "pair-pause",
  summary: "Pair, week 3 of 8: running pauses, a notice and a pending request (screens 26-30b)",
  accounts: [
    { email: "andrea.pausa@pactjoy.local", displayName: "Andrea" },
    { email: "victor.pausa@pactjoy.local", displayName: "Victor" },
  ],
  async run(seed: SeedContext, [andrea, victor]: readonly Actor[], today: string) {
    if (andrea === undefined || victor === undefined) throw new Error("pair needs two accounts");
    const start = addDays(today, -TODAY_DAY);
    const d = (n: number) => addDays(start, n);
    const season = await seedSeason({
      seed,
      circleName: "Andrea y Victor (pausa)",
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
              weightPercent: 40,
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
              weightPercent: 30,
              measure: { unit: "done", frequency: { kind: "specificDays", weekdays: EVERY_DAY } },
            },
            {
              key: "ingles",
              habit: "Inglés",
              icon: "brain",
              weightPercent: 30,
              measure: {
                unit: "minutes",
                direction: "reach",
                minimum: "60",
                ideal: "150",
                schedule: { period: "weeklyTotal" },
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

    // Days 0-12 happen first, then each pause is asked and answered on its own day.
    await recordPlan(seed, season, beforePauses(start));
    const inglesPause = await askAndApprove(seed, season, {
      day: d(12),
      asker: andrea,
      approver: victor,
      key: "ingles",
      reason: "travel",
      from: d(12),
      until: d(TODAY_DAY + 1),
    });
    await askAndApprove(seed, season, {
      day: d(13),
      asker: andrea,
      approver: victor,
      key: "meditar",
      reason: "health",
      from: d(13),
      until: null,
    });
    // Days 13-15 only for what is not paused (an entry on a paused day has no opportunity).
    await recordPlan(seed, season, afterPauses(start));

    // Today: Victor's request stays pending, so nobody has answered it yet.
    seed.setDate(today);
    const pending = must(
      await requestPause(seed.app, victor, {
        seasonId: season.seasonId,
        scope: { kind: "commitment", commitmentId: commitmentOf(season, "gym") },
        reason: "work",
        note: "Semana de entrega en el trabajo",
        startDate: localDate(today),
        endDate: localDate(d(TODAY_DAY + 6)),
      }),
      "requestPause gym",
    );
    seed.log(
      `pair-pause: season ${season.seasonId}; Inglés pause ${inglesPause} ends tomorrow, ` +
        `Meditar pause running, Victor's Gym request ${pending.id} pending (today is day 17).`,
    );
  },
};

function commitmentOf(season: SeededSeason, key: string) {
  const found = season.commitments.get(key);
  if (!found) throw new Error(`unknown commitment key ${key}`);
  return found.id;
}

/** The asker requests the pause on `day` and the approver approves it the same day. */
async function askAndApprove(
  seed: SeedContext,
  season: SeededSeason,
  options: {
    readonly day: string;
    readonly asker: Actor;
    readonly approver: Actor;
    readonly key: string;
    readonly reason: "health" | "travel" | "work" | "other";
    readonly from: string;
    readonly until: string | null;
  },
): Promise<string> {
  seed.setDate(options.day);
  const request = must(
    await requestPause(seed.app, options.asker, {
      seasonId: season.seasonId,
      scope: { kind: "commitment", commitmentId: commitmentOf(season, options.key) },
      reason: options.reason,
      note: null,
      startDate: localDate(options.from),
      endDate: options.until === null ? null : localDate(options.until),
    }),
    `requestPause ${options.key}`,
  );
  const decided = must(
    await respondToPause(seed.app, options.approver, {
      pauseRequestId: request.id,
      decision: "approve",
    }),
    `respondToPause ${options.key}`,
  );
  if (decided.status !== "approved") throw new Error(`pause ${options.key} was not approved`);
  return decided.id;
}

/** Registros of days 0-12 for both members. */
export function beforePauses(start: string): PlannedEntry[] {
  const d = (n: number) => addDays(start, n);
  const plan: PlannedEntry[] = [];
  const add = (n: number, key: string, value: PlannedEntry["value"]) =>
    plan.push({ day: d(n), key, value });
  for (const n of [0, 2, 4, 8, 10]) add(n, "leer", minutes(25));
  for (let n = 0; n <= 12; n++) if (n !== 6) add(n, "meditar", DONE);
  add(1, "ingles", minutes(60));
  add(5, "ingles", minutes(90));
  add(9, "ingles", minutes(70));
  for (const n of [0, 2, 4, 8, 10]) add(n, "gym", DONE);
  for (const n of [1, 3, 5, 8, 10, 12]) add(n, "dibujar", DONE);
  for (let n = 0; n <= 12; n++) if (n !== 5) add(n, "diario", minutes(10));
  return plan;
}

/** Days 13-15: Meditar and Inglés are paused, the rest carries on. */
export function afterPauses(start: string): PlannedEntry[] {
  const d = (n: number) => addDays(start, n);
  return [
    { day: d(13), key: "leer", value: minutes(20) },
    { day: d(14), key: "gym", value: DONE },
    { day: d(14), key: "diario", value: minutes(10) },
    { day: d(15), key: "diario", value: minutes(12) },
  ];
}
