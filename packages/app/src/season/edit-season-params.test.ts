import { describe, expect, it } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { seasonId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { givenOpenPactWithOneApproval } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { createSeason } from "./create-season.ts";
import { editSeasonParams } from "./edit-season-params.ts";
import type { Season } from "./season.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

// Noon UTC keeps the local calendar date "2025-09-28" stable in America/Santiago.
const NOW = instant(1_759_060_800_000);

async function givenOpenSeason(app: ReturnType<typeof createTestApp>) {
  const circle = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
  if (!circle.ok) throw new Error("fixture setup failed");
  const season = await createSeason(app, actorFor("user-andrea"), {
    circleId: circle.value.id,
    timezone: "America/Santiago",
    startDate: "2025-10-01",
    lengthWeeks: 8,
  });
  if (!season.ok) throw new Error("fixture setup failed");
  return { circle: circle.value, season: season.value };
}

describe("editSeasonParams", () => {
  it("SS-18 (B2): edits startDate while the pact is open and bumps the version", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenSeason(app);

    const result = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: season.id,
      startDate: "2025-10-05",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nominalStart).toBe("2025-10-05");
    expect(result.value.version).toBe(season.version + 1);

    const stored = await app.uow.read((repos) => repos.seasons.get(season.id));
    expect(stored?.nominalStart).toBe("2025-10-05");
    expect(stored?.version).toBe(season.version + 1);
  });

  it("B2: edits timezone, lengthWeeks and reviewCadenceWeeks together", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenSeason(app);

    const result = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: season.id,
      timezone: "Europe/Madrid",
      lengthWeeks: 4,
      reviewCadenceWeeks: 3,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timeZone).toBe("Europe/Madrid");
    expect(result.value.lengthWeeks).toBe(4);
    expect(result.value.reviewCadenceWeeks).toBe(3);
  });

  it("any active member may edit -- no owner/admin role (A4)", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season } = await givenOpenSeason(app);
    const invite = await generateInvite(app, actorFor("user-andrea"), { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const joined = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: invite.value.code,
    });
    expect(joined.ok).toBe(true);

    const result = await editSeasonParams(app, actorFor("user-victor"), {
      seasonId: season.id,
      startDate: "2025-10-06",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects when the season does not exist", async () => {
    const app = createTestApp({ now: NOW });
    await givenOpenSeason(app);

    const result = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: seasonId("no-such-season"),
      startDate: "2025-10-06",
    });

    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("rejects when the actor is not a member of the season's circle", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenSeason(app);

    const result = await editSeasonParams(app, actorFor("user-outsider"), {
      seasonId: season.id,
      startDate: "2025-10-06",
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("B2: rejects editing once the pact is no longer open", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenSeason(app);
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save({ ...season, status: "active", version: season.version + 1 }, 0);
      return ok(undefined);
    });

    const result = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: season.id,
      startDate: "2025-10-06",
    });

    expect(result).toEqual({ ok: false, error: { kind: "PactNotOpen" } });
  });

  it("rejects an invalid timezone and persists nothing", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenSeason(app);

    const result = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: season.id,
      timezone: "",
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidTimezone" } });
    const stored = await app.uow.read((repos) => repos.seasons.get(season.id));
    expect(stored?.timeZone).toBe(season.timeZone);
    expect(stored?.version).toBe(season.version);
  });

  it("SHOULD-FIX: rejects a lengthWeeks outside {4,6,8,12} at runtime and persists nothing", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenSeason(app);

    const result = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: season.id,
      lengthWeeks: 5 as unknown as 4,
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidLengthWeeks" } });
    const stored = await app.uow.read((repos) => repos.seasons.get(season.id));
    expect(stored?.version).toBe(season.version);
  });

  it("SHOULD-FIX: rejects a reviewCadenceWeeks outside {1,2,3} at runtime and persists nothing", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenSeason(app);

    const result = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: season.id,
      reviewCadenceWeeks: 7 as unknown as 1,
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidReviewCadenceWeeks" } });
    const stored = await app.uow.read((repos) => repos.seasons.get(season.id));
    expect(stored?.version).toBe(season.version);
  });

  it("SS-4/SS-5 delta: a new startDate must still respect the 30-day window", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await givenOpenSeason(app);

    const tooFar = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: season.id,
      startDate: "2025-10-30", // 32 days after 2025-09-28
    });
    expect(tooFar).toEqual({ ok: false, error: { kind: "StartDateTooFarAhead" } });

    const inPast = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: season.id,
      startDate: "2025-09-01",
    });
    expect(inPast).toEqual({ ok: false, error: { kind: "StartDateInPast" } });
  });

  it("technical decision: re-validates the A6 window when ONLY timezone changes -- a new zone changes what 'today' means for the UNCHANGED nominalStart", async () => {
    // A fake TimeZone where "zone-late" and "zone-early" read the SAME
    // instant as different local calendar dates -- a real IANA pair (e.g.
    // opposite sides of the international date line) can differ by a full
    // day too, but this fake makes the one-day shift exact and independent
    // of DST/tz-database specifics.
    const twoZoneTimeZone: TimeZone = {
      localDateAt(_at, zone) {
        return zone === "zone-early" ? localDate("2025-09-27") : localDate("2025-09-28");
      },
      isValidZone(zone) {
        return zone === "zone-early" || zone === "zone-late";
      },
    };
    const app = createTestApp({ now: NOW, timeZone: twoZoneTimeZone });
    const circle = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!circle.ok) throw new Error("fixture setup failed");
    // nominalStart is exactly 30 days ahead of "zone-late"'s today (2025-09-28) -- right at the A6 boundary, valid.
    const created = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "zone-late",
      startDate: "2025-10-28",
      lengthWeeks: 4,
    });
    if (!created.ok) throw new Error("fixture setup failed");

    // Switching to "zone-early" alone (nominalStart untouched) makes "today"
    // one day earlier (2025-09-27), so the SAME nominalStart is now 31 days
    // ahead -- outside the window. Must be re-validated and rejected.
    const result = await editSeasonParams(app, actorFor("user-andrea"), {
      seasonId: created.value.id,
      timezone: "zone-early",
    });

    expect(result).toEqual({ ok: false, error: { kind: "StartDateTooFarAhead" } });
    const stored = await app.uow.read((repos) => repos.seasons.get(created.value.id));
    expect(stored?.timeZone).toBe("zone-late");
    expect(stored?.version).toBe(created.value.version);
  });

  describe("no-op detection (SS-18, PI-S8..S11)", () => {
    async function givenApprovedSeason() {
      const app = createTestApp({ now: NOW });
      const { season } = await givenOpenPactWithOneApproval(app);
      expect(season.approvals).toHaveLength(1);
      return { app, season };
    }

    async function expectUntouched(app: ReturnType<typeof createTestApp>, before: Season) {
      const stored = await app.uow.read((repos) => repos.seasons.get(before.id));
      expect(stored).toEqual(before);
    }

    it("PI-S8: {} returns the unchanged season; approvals, version and pactRevision intact", async () => {
      const { app, season } = await givenApprovedSeason();

      const result = await editSeasonParams(app, actorFor("user-andrea"), { seasonId: season.id });

      expect(result).toEqual({ ok: true, value: season });
      await expectUntouched(app, season);
    });

    it("PI-S9: values equal to the stored ones are a no-op (no write)", async () => {
      const { app, season } = await givenApprovedSeason();

      const result = await editSeasonParams(app, actorFor("user-andrea"), {
        seasonId: season.id,
        timezone: season.timeZone,
        startDate: season.nominalStart,
        lengthWeeks: season.lengthWeeks,
        reviewCadenceWeeks: season.reviewCadenceWeeks,
      });

      expect(result).toEqual({ ok: true, value: season });
      await expectUntouched(app, season);
    });

    it.each([
      ["lengthWeeks", { lengthWeeks: 12 as const }],
      ["reviewCadenceWeeks", { reviewCadenceWeeks: 3 as const }],
      ["startDate", { startDate: "2025-10-02" }],
      ["timezone", { timezone: "Europe/Madrid" }],
    ])(
      "a change in %s alone is effective: resets approvals, bumps version and pactRevision",
      async (_f, patch) => {
        const { app, season } = await givenApprovedSeason();

        const result = await editSeasonParams(app, actorFor("user-andrea"), {
          seasonId: season.id,
          ...patch,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.approvals).toEqual([]);
        expect(result.value.version).toBe(season.version + 1);
        expect(result.value.pactRevision).toBe(season.pactRevision + 1);
      },
    );

    it("PI-S10: timezone 'utc' vs stored 'UTC' is compared as a raw string, so it is a change", async () => {
      const app = createTestApp({ now: NOW });
      const circle = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
      if (!circle.ok) throw new Error("fixture setup failed");
      const created = await createSeason(app, actorFor("user-andrea"), {
        circleId: circle.value.id,
        timezone: "UTC",
        startDate: "2025-10-01",
        lengthWeeks: 8,
      });
      if (!created.ok) throw new Error("fixture setup failed");

      const result = await editSeasonParams(app, actorFor("user-andrea"), {
        seasonId: created.value.id,
        timezone: "utc",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.timeZone).toBe("utc");
      expect(result.value.version).toBe(created.value.version + 1);
      expect(result.value.pactRevision).toBe(created.value.pactRevision + 1);
    });

    it("PI-S11: an invalid value still errors even when nothing else changes", async () => {
      const { app, season } = await givenApprovedSeason();

      const result = await editSeasonParams(app, actorFor("user-andrea"), {
        seasonId: season.id,
        lengthWeeks: 5 as unknown as 4,
      });

      expect(result).toEqual({ ok: false, error: { kind: "InvalidLengthWeeks" } });
      await expectUntouched(app, season);
    });

    it("PI-S11: a no-op does not re-check the window when the stored startDate is now in the past", async () => {
      const { app, season: fixture } = await givenApprovedSeason();
      const past: Season = {
        ...fixture,
        nominalStart: localDate("2025-09-01"),
        version: fixture.version + 1,
      };
      await app.uow.transaction(async (repos) => {
        await repos.seasons.save(past, fixture.version);
        return ok(undefined);
      });

      const result = await editSeasonParams(app, actorFor("user-andrea"), {
        seasonId: past.id,
        startDate: "2025-09-01",
      });

      expect(result).toEqual({ ok: true, value: past });
      await expectUntouched(app, past);
    });

    it("PI-S11: a no-op on a closed pact is still PactNotOpen (state check first)", async () => {
      const { app, season } = await givenApprovedSeason();
      await app.uow.transaction(async (repos) => {
        await repos.seasons.save(
          { ...season, status: "active", version: season.version + 1 },
          season.version,
        );
        return ok(undefined);
      });

      const result = await editSeasonParams(app, actorFor("user-andrea"), { seasonId: season.id });

      expect(result).toEqual({ ok: false, error: { kind: "PactNotOpen" } });
    });
  });
});
