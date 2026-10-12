import { describe, expect, it } from "vitest";
import { recordEntry } from "../entry/record-entry.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { atInstant, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { afterHours, givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { instant } from "../time/instant.ts";
import { requestPause } from "./request-pause.ts";
import { respondToPause } from "./respond-to-pause.ts";

/** Andrea asks at noon of day 5 (R1); Victor and Sofia are the approvers; auto-approval at noon of day 7. */
const T0 = localInstant(dayOf(5));
const DEADLINE = afterHours(T0, 48);

async function givenRequest(options: { sofia: boolean } = { sofia: true }) {
  const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withSofia: options.sofia });
  const created = await requestPause(app, world.andrea, {
    seasonId: world.season.id,
    scope: { kind: "commitment", commitmentId: world.andreaCommitment },
    reason: "health",
    note: null,
    startDate: dayOf(5),
    endDate: null,
  });
  if (!created.ok) throw new Error(`fixture failed: ${created.error.kind}`);
  return { app, world, request: created.value };
}

const respond = (
  app: TestApp,
  actor: PauseWorld["victor"],
  id: Awaited<ReturnType<typeof givenRequest>>["request"]["id"],
  decision: "approve" | "reject",
  at = app.clock.now(),
) => respondToPause(atInstant(app, at), actor, { pauseRequestId: id, decision });

const storedOf = async (
  app: TestApp,
  id: Awaited<ReturnType<typeof givenRequest>>["request"]["id"],
) => app.pauses.get(id);

describe("respondToPause (PL-10..PL-15, D3)", () => {
  it("PL-S6: a reject while another approver is silent and the window is open leaves it pending, and stores the response", async () => {
    const { app, world, request } = await givenRequest();
    const at = afterHours(DEADLINE, -1 / 60);

    const result = await respond(app, world.sofia, request.id, "reject", at);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("pending");
    expect(result.value.responses).toEqual([
      { memberId: "member-sofia", response: "reject", respondedAt: at },
    ]);
    // Still on hold for the requester.
    const entry = await recordEntry(atInstant(app, at), world.andrea, {
      seasonId: world.season.id,
      commitmentId: world.andreaCommitment,
      forDate: dayOf(7),
      value: { kind: "quantity", value: "30" },
      clientRequestId: "k1",
    });
    expect(entry).toEqual({ ok: false, error: { kind: "OpportunityOnHold" } });
  });

  it("PL-S6: once every approver has answered a reject decides at once, on the day (7) of the last response", async () => {
    const { app, world, request } = await givenRequest();
    await respond(app, world.victor, request.id, "approve", afterHours(T0, 1));
    const at = afterHours(DEADLINE, -1 / 60);

    const result = await respond(app, world.sofia, request.id, "reject", at);

    expect(result.ok && result.value).toMatchObject({
      status: "rejected",
      decidedAt: at,
      decidedOn: 7,
    });
    expect(await storedOf(app, request.id)).toMatchObject({ status: "rejected", version: 2 });
  });

  it("D3: with one approver (two members) his first answer decides", async () => {
    const { app, world, request } = await givenRequest({ sofia: false });

    const result = await respond(app, world.victor, request.id, "reject", afterHours(T0, 2));

    expect(result.ok && result.value.status).toBe("rejected");
  });

  it("all approvers approving approves at the last response", async () => {
    const { app, world, request } = await givenRequest();
    await respond(app, world.victor, request.id, "approve", afterHours(T0, 1));
    const at = afterHours(T0, 2);

    const result = await respond(app, world.sofia, request.id, "approve", at);

    expect(result.ok && result.value).toMatchObject({
      status: "approved",
      decidedAt: at,
      decidedOn: 5,
    });
  });

  it("PL-S7: after the deadline a late reject is PauseAlreadyDecided and the request stays approved on the deadline day", async () => {
    const { app, world, request } = await givenRequest();
    await respond(app, world.victor, request.id, "approve", afterHours(T0, 1));

    const late = await respond(
      app,
      world.sofia,
      request.id,
      "reject",
      afterHours(DEADLINE, 1 / 60),
    );

    expect(late).toEqual({ ok: false, error: { kind: "PauseAlreadyDecided" } });
    // The rejected write rolled back; the next read still derives the same decision.
    const stored = await storedOf(app, request.id);
    expect(stored?.status).toBe("pending");
    const later = await respond(app, world.victor, request.id, "reject", afterHours(DEADLINE, 2));
    expect(later).toEqual({ ok: false, error: { kind: "PauseAlreadyDecided" } });
  });

  it("PL-S8: at exactly the deadline the response is refused; one millisecond before it is accepted", async () => {
    const { app, world, request } = await givenRequest();

    const exact = await respond(app, world.sofia, request.id, "reject", DEADLINE);
    const before = await respond(app, world.sofia, request.id, "reject", instant(DEADLINE - 1));

    expect(exact).toEqual({ ok: false, error: { kind: "PauseAlreadyDecided" } });
    expect(before.ok).toBe(true);
  });

  it("PL-S9: a standing reject with a silent approver is rejected at the deadline", async () => {
    const { app, world, request } = await givenRequest();
    await respond(app, world.victor, request.id, "reject", afterHours(T0, 1));

    const late = await respond(app, world.sofia, request.id, "approve", afterHours(DEADLINE, 1));

    expect(late).toEqual({ ok: false, error: { kind: "PauseAlreadyDecided" } });
  });

  it("PL-S10 / Q3: an approver can change their answer while pending, and the request decides at the last answer", async () => {
    const { app, world, request } = await givenRequest();
    await respond(app, world.victor, request.id, "reject", afterHours(T0, 1));
    const changed = await respond(app, world.victor, request.id, "approve", afterHours(T0, 2));
    expect(changed.ok && changed.value.status).toBe("pending");

    const at = afterHours(T0, 3);
    const final = await respond(app, world.sofia, request.id, "approve", at);

    expect(final.ok && final.value).toMatchObject({
      status: "approved",
      decidedAt: at,
      decidedOn: 5,
    });
    expect(
      final.ok && final.value.responses.find((r) => r.memberId === "member-victor"),
    ).toMatchObject({
      response: "approve",
    });
  });

  it("PL-S11: a decided request is final: a later change fails and alters nothing", async () => {
    const { app, world, request } = await givenRequest();
    await respond(app, world.victor, request.id, "approve", afterHours(T0, 1));
    await respond(app, world.sofia, request.id, "approve", afterHours(T0, 2));

    const change = await respond(app, world.victor, request.id, "reject", afterHours(T0, 3));

    expect(change).toEqual({ ok: false, error: { kind: "PauseAlreadyDecided" } });
    expect((await storedOf(app, request.id))?.status).toBe("approved");
  });

  it("is idempotent: repeating the same answer changes nothing", async () => {
    const { app, world, request } = await givenRequest();
    const first = await respond(app, world.victor, request.id, "approve", afterHours(T0, 1));
    const again = await respond(app, world.victor, request.id, "approve", afterHours(T0, 5));

    expect(first.ok && again.ok && again.value).toEqual(first.ok && first.value);
    expect((await storedOf(app, request.id))?.version).toBe(1);
  });

  it("PL-S14: the requester cannot answer their own request", async () => {
    const { app, world, request } = await givenRequest();

    const result = await respond(app, world.andrea, request.id, "approve");

    expect(result).toEqual({ ok: false, error: { kind: "CannotRespondToOwnPause" } });
  });

  it("PA-S3: a stranger, a former member or an unknown id gets PauseRequestNotFound", async () => {
    const { app, world, request } = await givenRequest();

    const stranger = await respond(app, { userId: userId("user-nobody") }, request.id, "approve");
    const unknown = await respond(app, world.victor, "nope" as never, "approve");

    expect(stranger).toEqual({ ok: false, error: { kind: "PauseRequestNotFound" } });
    expect(unknown).toEqual({ ok: false, error: { kind: "PauseRequestNotFound" } });
  });

  it("PL-S15: two approvers answering at once both land: no lost update, one consistent outcome", async () => {
    const { app, world, request } = await givenRequest();
    const clocked = atInstant(app, afterHours(T0, 1));

    const { winner, loser } = await raceTransactions(
      clocked,
      (a) => respondToPause(a, world.victor, { pauseRequestId: request.id, decision: "approve" }),
      (a) => respondToPause(a, world.sofia, { pauseRequestId: request.id, decision: "approve" }),
    );

    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("fulfilled");
    const stored = await storedOf(app, request.id);
    expect(stored?.status).toBe("approved");
    expect(stored?.responses).toHaveLength(2);
  });
});
