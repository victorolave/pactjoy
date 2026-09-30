import type { Circle } from "../circle/circle.ts";
import { createCircle } from "../circle/create-circle.ts";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { addCommitment } from "../commitment/add-commitment.ts";
import { approvePact } from "../pact/approve-pact.ts";
import { createSeason } from "../season/create-season.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import { habitId, type SeasonId, userId } from "../shared/ids.ts";
import type { TestApp } from "./app-harness.ts";

export interface OpenPactWithOneApproval {
  readonly circle: Circle;
  readonly season: Season;
  /** Created the circle and approved. */
  readonly andrea: Actor;
  /** Joined, has a full-weight commitment, has NOT approved. */
  readonly victor: Actor;
}

function must<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) throw new Error("pact fixture setup failed");
  return result.value;
}

/**
 * GIVEN (for approval-reset seam tests): a two-member circle whose season
 * pact is still open, both members holding one 100%-weight commitment, and
 * exactly one recorded approval (Andrea's) -- Victor's is still missing, so
 * the pact cannot have closed yet.
 */
export async function givenOpenPactWithOneApproval(app: TestApp): Promise<OpenPactWithOneApproval> {
  const andrea: Actor = { userId: userId("user-andrea") };
  const victor: Actor = { userId: userId("user-victor") };
  const circle = must(await createCircle(app, andrea, { name: "Río Runners" }));
  const invite = must(await generateInvite(app, andrea, { circleId: circle.id }));
  must(await joinCircle(app, victor, { inviteCode: invite.code }));
  const created = must(
    await createSeason(app, andrea, {
      circleId: circle.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 8,
    }),
  );
  let season = created;
  for (const actor of [andrea, victor]) {
    season = must(
      await addCommitment(app, actor, {
        seasonId: season.id,
        habitId: habitId(`habit-${actor.userId}`),
        weightPercent: 100,
        privacy: "visible",
        measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
      }),
    );
  }
  season = must(await approvePact(app, andrea, { seasonId: season.id }));
  return { circle, season, andrea, victor };
}

/** Reads the season as currently persisted (bypasses use cases, for assertions). */
export async function storedSeason(app: TestApp, id: SeasonId): Promise<Season> {
  const season = await app.uow.read((repos) => repos.seasons.get(id));
  if (!season) throw new Error("season vanished");
  return season;
}
