import { displayPercent, frac } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberScoreView } from "../score/member-score.query.ts";
import { loadPausesFor, loadScoreContext } from "../score/score-context.ts";
import { seasonId } from "../shared/ids.ts";
import { localDate } from "../time/local-date.ts";
import { profileSummary } from "./profile-summary.query.ts";
import {
  givenProfileWorld,
  givenSeason,
  logDays,
  type ProfileWorld,
  plusDays,
  range,
  WEEKLY,
} from "./profile-world.ts";

/**
 * REQ-C4, SC-9: for ONE season the Perfil figures are the member's season consistency, because it
 * pools the integers `scoreMember` divides. Pinned against the season score read model.
 */
async function seasonConsistency(world: ProfileWorld, date: string, id: string) {
  const app = world.at(localDate(date));
  return app.uow.read(async (repos) => {
    const context = await loadScoreContext(app, repos, world.andrea, seasonId(id));
    if (!context.ok || context.value.start === null) throw new Error("not scored");
    const started = { ...context.value, start: context.value.start };
    const view = memberScoreView(
      started,
      {
        entries: await repos.entries.listBySeason(seasonId(id)),
        pauses: await loadPausesFor(app, repos, started),
      },
      started.viewer,
    );
    if (view.kind !== "scored") throw new Error("not scored");
    return view.consistency;
  });
}

describe("profileSummary parity with the season score", () => {
  it("a closed season's percent is the member's season consistency", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-a",
      start: localDate("2026-08-03"),
      status: "closed",
      commitments: [
        { id: "a-meditar", habit: "meditar", weight: 70 },
        { id: "a-leer", habit: "leer", weight: 30, measure: WEEKLY },
      ],
    });
    await logDays(world, "season-a", "a-meditar", range(0, 18));
    await logDays(world, "season-a", "a-leer", [2, 9, 16]);

    const { consistency } = await profileSummary(world.at(localDate("2026-10-05")), world.andrea);

    // Meditar kept 19 of 28, Leer 3 of 4: 22 of 32, pooled across commitments like R7.
    expect(consistency).toMatchObject({ kept: 22, counted: 32 });
    expect(consistency.percent).toBe(displayPercent(frac(22n, 32n)));
    expect(consistency.percent).toBe(await seasonConsistency(world, "2026-10-05", "season-a"));
  });

  it("a season in progress matches the season score on every day around its grace boundaries", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-b",
      start: localDate("2026-10-01"),
      status: "active",
      commitments: [
        { id: "b-meditar", habit: "meditar", weight: 70 },
        { id: "b-leer", habit: "leer", weight: 30, measure: WEEKLY },
      ],
    });
    await logDays(world, "season-b", "b-meditar", [0, 1, 2, 4, 5, 8, 9, 10, 12]);
    await logDays(world, "season-b", "b-leer", [3, 12]);

    for (let day = 1; day <= 34; day++) {
      const label = plusDays(localDate("2026-10-01"), day - 1);
      const { consistency } = await profileSummary(world.at(localDate(label)), world.andrea);
      expect(consistency.percent, label).toBe(await seasonConsistency(world, label, "season-b"));
    }
  });
});
