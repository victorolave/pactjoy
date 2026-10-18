import { describe, expect, it } from "vitest";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { DONE, MINUTES } from "./entries-fixture.ts";
import { ANDREA, setup } from "./harness.ts";

// After DELETE /me (ADR-0019) nothing of the erased person is readable by their circle: not the
// name, not a habit (visible or private), not a note. Their numbers stay (standings are unchanged),
// their old token is no member of anything, and a retry is a 200. Andrea is erased; Victor and
// Carla, her peers, use every read route that could carry her.
const SENTINEL_NAME = "SENTINEL-NAME-7e41c2";
const SENTINEL_VISIBLE_HABIT = "SENTINEL-VISIBLE-HABIT-b83d10";
const SENTINEL_PRIVATE_HABIT = "SENTINEL-PRIVATE-HABIT-4f9a62";
const SENTINEL_NOTE = "SENTINEL-NOTE-d20e75";
const SENTINEL_PAUSE_NOTE = "SENTINEL-PAUSE-NOTE-61bc08";
const SENTINELS = [
  SENTINEL_NAME,
  SENTINEL_VISIBLE_HABIT,
  SENTINEL_PRIVATE_HABIT,
  SENTINEL_NOTE,
  SENTINEL_PAUSE_NOTE,
];
const CONFIRM = { confirmation: "ELIMINAR" };
const day = (n: number) => Date.UTC(2023, 10, 13 + n, 17);

async function world() {
  const ctx = setup();
  const { call, setNow } = ctx;
  const circle = await call("POST", "/circles", "andrea", createCircleBody("Crew", SENTINEL_NAME));
  const circleId: string = circle.json.data.id;
  const invite = await call("POST", `/circles/${circleId}/invite`, "andrea");
  await call("POST", "/circles/join", "victor", joinCircleBody(invite.json.data.code, "Victor"));
  await call("POST", "/circles/join", "carla", joinCircleBody(invite.json.data.code, "Carla"));
  const season = await call("POST", `/circles/${circleId}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-14",
    lengthWeeks: 4,
  });
  const seasonId: string = season.json.data.id;

  let pactRevision = 0;
  const commit = async (
    who: string,
    name: string,
    privacy: string,
    weightPercent: number,
    measure: object,
  ) => {
    const habit = await call("POST", "/habits", who, { name });
    const added = await call("POST", `/seasons/${seasonId}/commitments`, who, {
      habitId: habit.json.data.id,
      weightPercent,
      privacy,
      measure,
    });
    expect(added.status).toBe(201);
    pactRevision = added.json.data.pactRevision;
    return added.json.data.commitments.find(
      (c: { habitId?: string }) => c.habitId === habit.json.data.id,
    ).id as string;
  };
  const visible = await commit("andrea", SENTINEL_VISIBLE_HABIT, "visible", 50, DONE);
  const hidden = await commit("andrea", SENTINEL_PRIVATE_HABIT, "private", 50, MINUTES);
  const victors = await commit("victor", "Correr", "visible", 100, MINUTES);
  const carlas = await commit("carla", "Leer", "visible", 100, MINUTES);
  for (const who of ["andrea", "victor", "carla"]) {
    await call("PUT", `/seasons/${seasonId}/approval`, who, { expectedPactRevision: pactRevision });
  }

  const record = async (who: string, commitmentId: string, n: number, extra: object = {}) => {
    setNow(day(n) as never);
    const res = await call("POST", `/seasons/${seasonId}/entries`, who, {
      commitmentId,
      value: commitmentId === visible ? { kind: "done" } : { kind: "quantity", value: "20" },
      clientRequestId: `${who}-${commitmentId}-${n}`,
      ...extra,
    });
    expect([who, n, res.status]).toEqual([who, n, 201]);
  };
  await record("andrea", visible, 1, { note: SENTINEL_NOTE });
  await record("andrea", hidden, 1, { note: SENTINEL_NOTE });
  for (let n = 1; n <= 3; n++) {
    await record("victor", victors, n);
    await record("carla", carlas, n);
  }
  const pause = await call("POST", `/seasons/${seasonId}/pause-requests`, "andrea", {
    scope: { kind: "commitment", commitmentId: hidden },
    reason: "health",
    note: SENTINEL_PAUSE_NOTE,
    startDate: "2023-11-17",
    endDate: "2023-11-18",
  });
  expect(pause.status).toBe(201);
  for (const who of ["victor", "carla"]) {
    const res = await call("PUT", `/pause-requests/${pause.json.data.id}/response`, who, {
      decision: "approve",
    });
    expect([who, res.status]).toEqual([who, 200]);
  }
  setNow(day(4) as never);

  const circleView = await call("GET", "/me/circle", "victor");
  const andreaMember: string = circleView.json.data.circle.members.find(
    (m: { displayName: string }) => m.displayName === SENTINEL_NAME,
  ).id;
  return { ...ctx, circleId, seasonId, visible, hidden, andreaMember };
}

type World = Awaited<ReturnType<typeof world>>;

/** Every read a peer has that could carry Andrea. */
function peerReads(w: World): [label: string, path: string][] {
  const s = `/seasons/${w.seasonId}`;
  return [
    ["circle", "/me/circle"],
    ["today", "/me/today"],
    ["feed", "/me/feed"],
    ["pauses", "/me/pause-requests"],
    ["profile", "/me/profile"],
    ["seasons", "/me/seasons"],
    ["season", s],
    ["standings", `${s}/standings`],
    ["progress", `${s}/progress`],
    ["week", `${s}/weeks/1/summary`],
    ["andrea progress", `${s}/members/${w.andreaMember}/progress`],
    ["andrea score", `${s}/members/${w.andreaMember}/score`],
    ["visible commitment", `${s}/commitments/${w.visible}/progress`],
    ["hidden commitment", `${s}/commitments/${w.hidden}/progress`],
  ];
}

/** The `displayName` of every object that carries `memberId` and a name, anywhere in `json`. */
function namesOf(json: unknown, memberId: string, out: string[] = []): string[] {
  if (Array.isArray(json)) {
    for (const item of json) namesOf(item, memberId, out);
  } else if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    if (record.memberId === memberId && typeof record.displayName === "string") {
      out.push(record.displayName);
    }
    for (const value of Object.values(record)) namesOf(value, memberId, out);
  }
  return out;
}

async function readAll(w: World, who: "victor" | "carla") {
  const out: Record<string, { status: number; text: string }> = {};
  for (const [label, path] of peerReads(w)) {
    const res = await w.call("GET", path, who);
    out[label] = { status: res.status, text: JSON.stringify(res.json) };
  }
  return out;
}

describe("DELETE /me leaves nothing of the person readable by their circle (ADR-0019)", () => {
  it("before the deletion the peers do see the name and the visible habit (the reads are not vacuous)", async () => {
    const w = await world();
    const reads = await readAll(w, "victor");
    for (const label of ["circle", "standings", "progress"]) {
      expect([label, reads[label]?.text.includes(SENTINEL_NAME)]).toEqual([label, true]);
    }
    expect(reads.season?.text).toContain(SENTINEL_VISIBLE_HABIT);
    expect(reads.feed?.text).toContain(SENTINEL_VISIBLE_HABIT);
    expect(reads.week?.status).toBe(200);
  });

  it("afterwards no read of either peer carries a sentinel name, habit or note, and none fails with a 5xx", async () => {
    const w = await world();
    const before = await readAll(w, "victor");
    const deleted = await w.call("DELETE", "/me", "andrea", CONFIRM);
    expect([deleted.status, deleted.json]).toEqual([200, { data: null }]);

    for (const who of ["victor", "carla"] as const) {
      const after = await readAll(w, who);
      for (const [label, read] of Object.entries(after)) {
        expect([who, label, read.status < 500]).toEqual([who, label, true]);
        for (const sentinel of SENTINELS) {
          expect([who, label, sentinel, read.text.includes(sentinel)]).toEqual([
            who,
            label,
            sentinel,
            false,
          ]);
        }
      }
      // Her member screen still resolves, with the empty erased-name sentinel (the web renders it
      // "Miembro que salió"); in the feed she is a leaver (no name), and her commitments are hidden.
      const member = JSON.parse(after["andrea progress"]?.text ?? "null");
      expect(namesOf(member, w.andreaMember)).toEqual([""]);
      expect(member.data.commitments.map((c: { kind: string }) => c.kind)).toEqual([
        "hidden",
        "hidden",
      ]);
      const feedMembers = JSON.parse(after.feed?.text ?? "null").data.members;
      expect(feedMembers.find((m: { id: string }) => m.id === w.andreaMember)).toEqual({
        id: w.andreaMember,
        displayName: null,
        isYou: false,
        left: true,
      });
      // Like any leaver she is no longer ranked: the standings are the two peers, names intact.
      const ranked = JSON.parse(after.standings?.text ?? "null").data.rows;
      expect(ranked.map((row: { displayName: string }) => row.displayName).sort()).toEqual([
        "Carla",
        "Victor",
      ]);
    }
    // The pre-deletion reads were non-trivial, so the absence above is the erasure's doing.
    expect(before.standings?.text).toContain(SENTINEL_NAME);
    expect(namesOf(JSON.parse(before["andrea progress"]?.text ?? "null"), w.andreaMember)).toEqual([
      SENTINEL_NAME,
    ]);
    expect(before["andrea progress"]?.text).toContain(SENTINEL_VISIBLE_HABIT);
  });

  it("the erased user's old token is a member of nothing: no circle, no season", async () => {
    const w = await world();
    await w.call("DELETE", "/me", "andrea", CONFIRM);
    const circle = await w.call("GET", "/me/circle", "andrea");
    expect(circle.json).toEqual({ data: { circle: null, season: null } });
    const season = await w.call("GET", `/seasons/${w.seasonId}`, "andrea");
    expect([season.status, season.json.error.code]).toEqual([403, "NotAMember"]);
    const entry = await w.call("POST", `/seasons/${w.seasonId}/entries`, "andrea", {
      commitmentId: w.visible,
      value: { kind: "done" },
      clientRequestId: "after-deletion",
    });
    expect(entry.status).toBe(403);
  });

  it("a retry of DELETE /me is a 200 and asks the identity provider again", async () => {
    const w = await world();
    const first = await w.call("DELETE", "/me", "andrea", CONFIRM);
    const retry = await w.call("DELETE", "/me", "andrea", CONFIRM);
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(w.app.identity.deleted).toEqual([ANDREA, ANDREA]);
  });
});
