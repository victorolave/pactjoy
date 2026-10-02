import { describe, expect, it } from "vitest";
import { DONE, givenSeason, REACH } from "./season-fixture.ts";

type Who = "andrea" | "victor";
type Given = Awaited<ReturnType<typeof givenSeason>>;
type Dto = { kind: string; habitId?: string; weightPercent: number };

/**
 * Every season mutation answers with the season as the ACTING member sees it (SV-R2, Q8). Each
 * entry runs one mutation as the given member. Andrea owns the private commitment; Victor never
 * may see its detail.
 */
const MUTATIONS: Record<string, (g: Given, who: Who) => ReturnType<Given["call"]>> = {
  editSeasonParams: (g, who) => g.call("PATCH", g.path, who, { lengthWeeks: 8 }),
  addCommitment: async (g, who) => {
    const habit = await g.call("POST", "/habits", who, { name: `Extra-${who}` });
    return g.call("POST", `${g.path}/commitments`, who, {
      habitId: habit.json.data.id,
      weightPercent: 10,
      privacy: "visible",
      measure: DONE,
    });
  },
  editCommitment: (g, who) =>
    who === "andrea"
      ? g.call("PUT", `${g.path}/commitments/${g.secretCommitmentId}`, who, {
          weightPercent: 50,
          privacy: "private",
          measure: REACH,
        })
      : g.call("PUT", `${g.path}/commitments/${g.victorCommitmentId}`, who, {
          weightPercent: 100,
          privacy: "visible",
          measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 2 } },
        }),
  removeCommitment: (g, who) =>
    g.call(
      "DELETE",
      `${g.path}/commitments/${who === "andrea" ? g.openCommitmentId : g.victorCommitmentId}`,
      who,
    ),
  approvePact: async (g, who) => {
    const seen = await g.call("GET", g.path, who);
    return g.call("PUT", `${g.path}/approval`, who, {
      expectedPactRevision: seen.json.data.pactRevision,
    });
  },
  // Nothing to withdraw yet: the idempotent no-op path must carry the viewer too.
  withdrawApproval: (g, who) => g.call("DELETE", `${g.path}/approval`, who),
};

describe("season mutation responses are viewer-aware (SV-S5, SV-S6, UE-S1..S5, UE-P1, UE-P2)", () => {
  for (const [name, run] of Object.entries(MUTATIONS)) {
    it(`${name}: the owner sees their private commitment in full`, async () => {
      const given = await givenSeason({ victorCommitment: true });
      const { status, json } = await run(given, "andrea");
      expect(status).toBeLessThan(300);
      const secret = json.data.commitments.find((c: Dto) => c.habitId === given.secretHabit);
      expect(secret).toMatchObject({
        kind: "detail",
        habitId: given.secretHabit,
        privacy: "private",
        measure: { unit: "minutes" },
      });
    });

    it(`${name}: another member never sees that private commitment's detail`, async () => {
      const given = await givenSeason({ victorCommitment: true });
      const { status, json } = await run(given, "victor");
      expect(status).toBeLessThan(300);
      const text = JSON.stringify(json);
      expect(text).not.toContain(given.secretHabit);
      expect(text).not.toContain('"minutes"');
      expect(json.data.commitments.some((c: Dto) => c.kind === "hidden")).toBe(true);
    });
  }
});
