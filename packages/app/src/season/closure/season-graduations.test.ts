import type { MemberId } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { commitmentId } from "../../commitment/commitment.ts";
import { seasonClosureId, seasonId } from "../../shared/ids.ts";
import { createTestApp } from "../../testing/app-harness.ts";
import { seasonClosureFixture } from "../../testing/builders.ts";
import { instant } from "../../time/instant.ts";
import { seedClosure } from "./closure-seed.ts";
import { seasonGraduations } from "./season-graduations.ts";

const SEASON = seasonId("season-1");
const OTHER = seasonId("season-2");
const ANDREA = "member-andrea" as MemberId;
const VICTOR = "member-victor" as MemberId;
const [READ, RUN, SWIM, WALK] = ["read", "run", "swim", "walk"].map(commitmentId) as [
  ReturnType<typeof commitmentId>,
  ReturnType<typeof commitmentId>,
  ReturnType<typeof commitmentId>,
  ReturnType<typeof commitmentId>,
];

async function read(app: ReturnType<typeof createTestApp>, id = SEASON) {
  return app.uow.read((repos) => seasonGraduations(repos, id));
}

describe("seasonGraduations: the graduate decisions of one season and nothing else", () => {
  it("is empty when nobody has closed", async () => {
    expect(await read(createTestApp())).toEqual([]);
  });

  it("returns only the graduate decisions, as member, commitment and instant", async () => {
    const app = createTestApp();
    await seedClosure(
      app,
      seasonClosureFixture({
        seasonId: SEASON,
        memberId: ANDREA,
        decisions: [
          { commitmentId: READ, decision: "graduate" },
          { commitmentId: RUN, decision: "continue" },
          { commitmentId: SWIM, decision: "adjust" },
          { commitmentId: WALK, decision: "pause" },
        ],
        decidedAt: instant(111),
      }),
    );
    const graduations = await read(app);
    expect(graduations).toEqual([{ memberId: ANDREA, commitmentId: READ, decidedAt: 111 }]);
    expect(Object.keys(graduations[0] ?? {}).sort()).toEqual([
      "commitmentId",
      "decidedAt",
      "memberId",
    ]);
  });

  it("collects every member's graduations and ignores another season's", async () => {
    const app = createTestApp();
    await seedClosure(
      app,
      seasonClosureFixture({
        id: seasonClosureId("closure-a"),
        seasonId: SEASON,
        memberId: ANDREA,
        decisions: [{ commitmentId: READ, decision: "graduate" }],
        decidedAt: instant(1),
      }),
    );
    await seedClosure(
      app,
      seasonClosureFixture({
        id: seasonClosureId("closure-v"),
        seasonId: SEASON,
        memberId: VICTOR,
        decisions: [{ commitmentId: RUN, decision: "graduate" }],
        decidedAt: instant(2),
      }),
    );
    await seedClosure(
      app,
      seasonClosureFixture({
        id: seasonClosureId("closure-o"),
        seasonId: OTHER,
        memberId: ANDREA,
        decisions: [{ commitmentId: SWIM, decision: "graduate" }],
        decidedAt: instant(3),
      }),
    );
    const found = await read(app);
    expect(found.map((g) => g.commitmentId).sort()).toEqual([READ, RUN]);
    expect((await read(app, OTHER)).map((g) => g.commitmentId)).toEqual([SWIM]);
  });
});
