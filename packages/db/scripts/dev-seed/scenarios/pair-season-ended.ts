import type { Actor } from "@pactjoy/app";
import { skipBaseline, submitReview, submitSeasonClosure } from "@pactjoy/app";
import {
  addDays,
  must,
  type PlannedEntry,
  recordPlan,
  type SeedContext,
  type SeededSeason,
  seedSeason,
  weekdayOf,
} from "../core.ts";
import type { Scenario } from "../scenario.ts";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;
const TUE_THU_SAT = [1, 3, 5] as const;
const LENGTH_WEEKS = 4;
/** Season day E = L * 7: the last day of the season. Days below are 1-based, like the spec. */
const LAST_DAY = LENGTH_WEEKS * 7;

const minutes = (value: number) => ({ kind: "quantity", value: String(value) }) as const;
const DONE = { kind: "done" } as const;

/**
 * A 4-week pair season that has just ended (design 36-38b). The real "today" is season day
 * E + `daysAfterEnd`: with 2 the results and the closure just opened and nobody has closed; with 8
 * the circle may move on without whoever did not close (Andrea closed, Victor did not).
 * Review cadence is weekly (the default for 4 weeks), so there is a baseline, three interim
 * reviews (the second one asks the full SRBAI) and the closing review.
 *
 * Andrea: Leer is `integrated` (four weeks at 100 %, automaticity 6), so screen 37 highlights
 * "Graduar"; Meditar is `developing`; Máximo 1 café al día collapses in week 4 (`new`).
 * Victor skips the baseline (no "inicio" bar); his private Diario is `integrated`, Gym is
 * `developing` and Dibujar `new`.
 */
function endedPair(options: {
  readonly id: string;
  readonly summary: string;
  readonly emails: readonly [string, string];
  readonly circleName: string;
  readonly daysAfterEnd: number;
  readonly andreaCloses: boolean;
}): Scenario {
  return {
    id: options.id,
    summary: options.summary,
    accounts: [
      { email: options.emails[0], displayName: "Andrea" },
      { email: options.emails[1], displayName: "Victor" },
    ],
    async run(seed: SeedContext, [andrea, victor]: readonly Actor[], today: string) {
      if (andrea === undefined || victor === undefined) throw new Error("pair needs two accounts");
      const start = addDays(today, -(LAST_DAY + options.daysAfterEnd - 1));
      const season = await seedSeason({
        seed,
        circleName: options.circleName,
        createdOn: addDays(start, -1),
        startDate: start,
        lengthWeeks: LENGTH_WEEKS,
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
                key: "cafe",
                habit: "Máximo 1 café al día",
                icon: "coffee",
                weightPercent: 30,
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
                measure: {
                  unit: "done",
                  frequency: { kind: "specificDays", weekdays: TUE_THU_SAT },
                },
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
      await recordPlan(seed, season, endedPlan(start));
      await submitReviews(seed, season, start, andrea, victor);
      if (options.andreaCloses) await andreaCloses(seed, season, start, andrea);
      seed.setDate(today);
      seed.log(
        `${options.id}: season ${season.seasonId} started ${start}; today is day ${LAST_DAY + options.daysAfterEnd}` +
          ` (E+${options.daysAfterEnd}).`,
      );
    },
  };
}

/** The registros of the whole season (offsets 0–27), none after the last day. */
export function endedPlan(start: string): PlannedEntry[] {
  const d = (n: number) => addDays(start, n);
  const plan: PlannedEntry[] = [];
  const add = (n: number, key: string, value: PlannedEntry["value"], extra = {}) =>
    plan.push({ day: d(n), key, value, ...extra });

  // Andrea · Leer: three sessions a week, every one above the minimum -> integrated.
  const leer = [
    [30, 30, 25],
    [30, 20, 30],
    [30, 30, 30],
    [30, 25, 30],
  ] as const;
  for (const [week, sessions] of leer.entries()) {
    for (const [i, value] of sessions.entries()) {
      add(
        week * 7 + i * 2,
        "leer",
        minutes(value),
        week === 0 && i === 1 ? { note: "Cap. 3" } : {},
      );
    }
  }

  // Andrea · Meditar: a decent start, a rough week 2, a strong finish -> developing.
  const meditarDays = [6, 4, 6, 7];
  for (const [week, count] of meditarDays.entries()) {
    for (let i = 0; i < 7; i++) {
      const n = week * 7 + i;
      if (i < count) add(n, "meditar", DONE, n === 9 ? { lateBy: 1 } : {});
      else if (week === 1 && i === 4) add(n, "meditar", { kind: "missed" });
    }
  }

  // Andrea · Café: one a day for two weeks, then it slips and week 4 is over the tolerance -> new.
  for (let n = 0; n <= 27; n++) {
    const week = Math.floor(n / 7);
    const i = n % 7;
    const value = week < 2 ? 1 : week === 2 ? (i % 2 === 0 ? 1 : 2) : i < 2 ? 1 : 4;
    add(n, "cafe", minutes(value));
  }

  // Victor · Gym: three a week, week 2 with only two -> developing.
  for (let week = 0; week < 4; week++) {
    for (const i of week === 1 ? [0, 3] : [0, 2, 4]) add(week * 7 + i, "gym", DONE);
  }

  // Victor · Dibujar (Tue/Thu/Sat): complete in week 1, thinner after, one of three in week 4 -> new.
  const drawPerWeek = [3, 2, 2, 1];
  const taken = [0, 0, 0, 0];
  for (let n = 0; n <= 27; n++) {
    if (!TUE_THU_SAT.includes(weekdayOf(d(n)) as 1)) continue;
    const week = Math.floor(n / 7);
    if ((taken[week] ?? 0) < (drawPerWeek[week] ?? 0)) {
      taken[week] = (taken[week] ?? 0) + 1;
      add(n, "dibujar", DONE);
    }
  }

  // Victor · Diario (private): at least six days a week, longer sessions at the end -> integrated.
  for (let n = 0; n <= 27; n++) {
    const week = Math.floor(n / 7);
    const i = n % 7;
    if (week < 2 && i === 6) continue;
    add(n, "diario", minutes(week < 2 ? 10 : 15));
  }
  return plan;
}

type Items = readonly [number, number | null, number | null, number | null];

const full = (a: number, b: number, c: number, e: number): Items => [a, b, c, e];
const first = (a: number): Items => [a, null, null, null];

/**
 * Baseline (Andrea only), interim reviews 1–3 (day 9, 17, 24) and Andrea's/Victor's closing
 * review is left pending unless `andreaCloses`. Item 1 of the LAST answer feeds the stage.
 */
async function submitReviews(
  seed: SeedContext,
  season: SeededSeason,
  start: string,
  andrea: Actor,
  victor: Actor,
): Promise<void> {
  const answers = (who: Actor, byKey: Record<string, Items>) =>
    Object.entries(byKey).map(([key, items]) => {
      const target = season.commitments.get(key);
      if (!target || target.actor !== who) throw new Error(`commitment ${key} is not theirs`);
      return { commitmentId: target.id, items };
    });
  const reflection = (helped: string | null, hard: string | null) => ({ helped, hard });
  const submit = async (
    who: Actor,
    offset: number,
    periodIndex: number,
    byKey: Record<string, Items>,
    text = reflection(null, null),
  ) => {
    seed.setDate(addDays(start, offset));
    must(
      await submitReview(seed.app, who, {
        seasonId: season.seasonId,
        periodIndex,
        reflection: text,
        automaticity: answers(who, byKey),
      }),
      `submitReview ${periodIndex}`,
    );
  };

  // Baseline (day 2): Andrea starts low everywhere; Victor says "Ahora no".
  await submit(andrea, 1, 0, {
    leer: full(2, 2, 3, 2),
    meditar: full(3, 3, 2, 3),
    cafe: full(2, 1, 2, 2),
  });
  seed.setDate(addDays(start, 1));
  must(
    await skipBaseline(seed.app, victor, { seasonId: season.seasonId, periodIndex: 0 }),
    "skipBaseline",
  );

  // Interim 1 (item 1 only), interim 2 (full SRBAI, mid-season), interim 3 (item 1 only).
  await submit(
    andrea,
    8,
    1,
    { leer: first(3), meditar: first(3), cafe: first(2) },
    reflection("Leer antes de dormir", "Las mañanas"),
  );
  await submit(andrea, 16, 2, {
    leer: full(5, 5, 5, 4),
    meditar: full(4, 4, 4, 3),
    cafe: full(2, 2, 2, 2),
  });
  await submit(
    andrea,
    23,
    3,
    { leer: first(6), meditar: first(4), cafe: first(2) },
    reflection("Un horario fijo", "Dejar el café"),
  );

  await submit(victor, 8, 1, { gym: first(3), dibujar: first(3), diario: first(4) });
  await submit(victor, 16, 2, {
    gym: full(4, 4, 3, 4),
    dibujar: full(3, 3, 3, 2),
    diario: full(5, 5, 5, 5),
  });
  await submit(victor, 23, 3, { gym: first(4), dibujar: first(2), diario: first(5) });
}

/** Andrea hands in her closing review and her closure on the results day (day E+3, season day 31). */
async function andreaCloses(
  seed: SeedContext,
  season: SeededSeason,
  start: string,
  andrea: Actor,
): Promise<void> {
  const item = (key: string) => {
    const target = season.commitments.get(key);
    if (!target) throw new Error(`unknown commitment ${key}`);
    return target.id;
  };
  seed.setDate(addDays(start, LAST_DAY + 2));
  must(
    await submitReview(seed.app, andrea, {
      seasonId: season.seasonId,
      periodIndex: 4,
      reflection: { helped: "Leer cada dos días", hard: "El café de la tarde" },
      automaticity: [
        { commitmentId: item("leer"), items: [6, 6, 6, 6] },
        { commitmentId: item("meditar"), items: [4, 4, 5, 4] },
        { commitmentId: item("cafe"), items: [2, 2, 3, 2] },
      ],
    }),
    "submitReview closing",
  );
  must(
    await submitSeasonClosure(seed.app, andrea, {
      seasonId: season.seasonId,
      decisions: [
        { commitmentId: item("leer"), decision: "continue" },
        { commitmentId: item("meditar"), decision: "adjust" },
        { commitmentId: item("cafe"), decision: "pause" },
      ],
    }),
    "submitSeasonClosure",
  );
}

export const pairSeasonEnded: Scenario = endedPair({
  id: "pair-season-ended",
  summary: "Pair, 4-week season ended: results open (day E+2), closing review pending for both",
  emails: ["andrea.cierre@pactjoy.local", "victor.cierre@pactjoy.local"],
  circleName: "Andrea y Victor (cierre)",
  daysAfterEnd: 2,
  andreaCloses: false,
});

export const pairSeasonStale: Scenario = endedPair({
  id: "pair-season-stale",
  summary: "Pair, 4-week season ended 8 days ago: Andrea closed, Victor did not (move-on open)",
  emails: ["andrea.vencida@pactjoy.local", "victor.vencida@pactjoy.local"],
  circleName: "Andrea y Victor (vencida)",
  daysAfterEnd: 8,
  andreaCloses: true,
});
