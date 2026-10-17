import { describe, expect, it } from "vitest";
import { createTestApp } from "../testing/app-harness.ts";
import { atInstant } from "../testing/entry-fixtures.ts";
import { givenOpenPactWithOneApproval, storedSeason } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { approvePact } from "./approve-pact.ts";

/**
 * `pactPendingApproval` (ADR-0017, design J5, agy #11): enqueued by `approvePact` while the pact
 * stays open, to every active member who has not approved yet (so never the approver), at most
 * once per recipient, season and season-local day (owner decision: one push per day).
 */

const DAY_MS = 86_400_000;
/** 2025-09-28T12:00:00Z: inside the fixture season's start window. */
const NOW = instant(1_759_060_800_000);

describe("pactPendingApproval", () => {
  it("an approval that leaves the pact open notifies the members still missing", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenPactWithOneApproval(app);
    const victor = (await storedSeason(app, season.id)).commitments.find(
      (c) => !season.approvals.some((a) => a.memberId === c.memberId),
    )?.memberId;

    const rows = app.notifications.all();
    expect(rows.map((n) => [n.kind, n.recipientMemberId])).toEqual([
      ["pactPendingApproval", victor],
    ]);
    const localDate = app.timeZone.localDateAt(app.clock.now(), season.timeZone);
    expect(rows[0]).toMatchObject({
      dedupeKey: `pactPending:${season.id}:${victor}:${localDate}`,
      params: { seasonId: season.id, pactRevision: season.pactRevision },
      seasonId: season.id,
      notBefore: app.clock.now(),
      expiresAt: instant(app.clock.now() + DAY_MS),
      rolloversLeft: 0,
    });
  });

  it("SC-O2: approving again the same day adds no second notice", async () => {
    const app = createTestApp({ now: NOW });
    const { season, andrea } = await givenOpenPactWithOneApproval(app);
    const again = await approvePact(app, andrea, {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    expect(again.ok).toBe(true);
    expect(app.notifications.all()).toHaveLength(1);
  });

  it("a re-approval on a later local day notifies again", async () => {
    const app = createTestApp({ now: NOW });
    const { season, andrea } = await givenOpenPactWithOneApproval(app);
    const tomorrow = atInstant(app, instant(app.clock.now() + DAY_MS));
    await approvePact(tomorrow, andrea, {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    expect(app.notifications.all()).toHaveLength(2);
  });

  it("the approval that closes the pact notifies nobody", async () => {
    const app = createTestApp({ now: NOW });
    const { season, victor } = await givenOpenPactWithOneApproval(app);
    const closed = await approvePact(app, victor, {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    expect(closed.ok && closed.value.season.status).toBe("active");
    expect(app.notifications.all()).toHaveLength(1);
  });

  it("a rejected approval (stale revision) leaves no notice", async () => {
    const app = createTestApp({ now: NOW });
    const { season, victor } = await givenOpenPactWithOneApproval(app);
    const before = app.notifications.all().length;
    const stale = await approvePact(app, victor, {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision + 1,
    });
    expect(stale.ok).toBe(false);
    expect(app.notifications.all()).toHaveLength(before);
  });
});
