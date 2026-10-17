import { instant, type SignedRequest } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { DONE, givenTwoMemberSeason, MINUTES } from "./entries-fixture.ts";
import { ANDREA, CARLA, setup, VICTOR } from "./harness.ts";

// Privacy by construction (ADR-0011 Q25, ADR-0018): the social routes serve existence, names of
// VISIBLE habits and counts, never the private facts behind them. Andrea owns a private commitment
// with sentinel text, a photo, a quantity, a hard week and a pause with a note; Victor and Carla,
// her peers, use every social route. SO-P1..P6.
const SENTINEL_HABIT = "SENTINEL-HABIT-5b21e9";
const SENTINEL_NOTE = "SENTINEL-NOTE-9c04d7";
const SENTINEL_PAUSE_NOTE = "SENTINEL-PAUSE-NOTE-31ae6f";
const QUANTITY = "7.25";
/** Reach with a minimum of 5, so 7.25 minutes counts as a kept session. */
const PRIVATE_MEASURE = { ...MINUTES, minimum: "5" };

const day = (n: number) => Date.UTC(2023, 10, 13 + n, 17);

const FORBIDDEN_KEYS = new Set([
  "note",
  "photoId",
  "photo",
  "objectKey",
  "version",
  "sentOn",
  "dismissedOn",
  "dismissedAt",
  "sentAt",
  "reactedAt",
  "reactorId",
  "reactors",
  "userId",
  "commitmentId",
  "habitId",
  "entryId",
]);

function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

async function world() {
  const ctx = setup();
  const { call, app, setNow } = ctx;
  const circle = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
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
  const commit = async (who: string, name: string, privacy: string, measure: object) => {
    const habit = await call("POST", "/habits", who, { name });
    const added = await call("POST", `/seasons/${seasonId}/commitments`, who, {
      habitId: habit.json.data.id,
      weightPercent: 100,
      privacy,
      measure,
    });
    pactRevision = added.json.data.pactRevision;
    return {
      habitId: habit.json.data.id as string,
      commitmentId: added.json.data.commitments.find(
        (c: { habitId?: string }) => c.habitId === habit.json.data.id,
      ).id as string,
    };
  };
  const secret = await commit("andrea", SENTINEL_HABIT, "private", PRIVATE_MEASURE);
  const victors = await commit("victor", "Correr", "visible", MINUTES);
  const carlas = await commit("carla", "Leer", "visible", MINUTES);
  for (const who of ["andrea", "victor", "carla"]) {
    await call("PUT", `/seasons/${seasonId}/approval`, who, { expectedPactRevision: pactRevision });
  }

  // Andrea's photo, reserved and uploaded through the fake storage like photo-privacy.test.ts.
  const reserved = await call(
    "POST",
    `/seasons/${seasonId}/commitments/${secret.commitmentId}/photos`,
    "andrea",
    { byteSize: 2048, contentType: "image/jpeg" },
  );
  const photoId: string = reserved.json.data.photoId;
  const bytes = new Uint8Array(2048);
  bytes.set([0xff, 0xd8, 0xff]);
  const up = reserved.json.data.upload;
  const request: SignedRequest = {
    url: up.url,
    method: up.method,
    headers: up.headers,
    expiresAt: Date.parse(up.expiresAt) as never,
  };
  expect(app.evidence.upload(request, bytes)).toBe("accepted");
  const objectKey = app.entryPhotos.all().find((row) => row.id === photoId)?.objectKey ?? "";
  expect(objectKey).not.toBe("");

  // Day 1: Andrea logs ONE of her three week-1 sessions (a hard week), with photo, note, quantity.
  setNow(day(1) as never);
  const logged = await call("POST", `/seasons/${seasonId}/entries`, "andrea", {
    commitmentId: secret.commitmentId,
    value: { kind: "quantity", value: QUANTITY },
    clientRequestId: "andrea-1",
    photoId,
    note: SENTINEL_NOTE,
  });
  expect(logged.status).toBe(201);
  const entryId: string = logged.json.data.entry.id;
  // Days 1-9: Victor and Carla log every day (a feed long enough for a second page).
  for (let n = 1; n <= 9; n++) {
    setNow(day(n) as never);
    for (const [who, c] of [
      ["victor", victors],
      ["carla", carlas],
    ] as const) {
      const res = await call("POST", `/seasons/${seasonId}/entries`, who, {
        commitmentId: c.commitmentId,
        value: { kind: "quantity", value: "20" },
        clientRequestId: `${who}-${n}`,
      });
      expect([who, n, res.status]).toEqual([who, n, 201]);
    }
  }
  // Day 9: Andrea pauses her private commitment with a note; both peers approve.
  const pause = await call("POST", `/seasons/${seasonId}/pause-requests`, "andrea", {
    scope: { kind: "commitment", commitmentId: secret.commitmentId },
    reason: "health",
    note: SENTINEL_PAUSE_NOTE,
    startDate: "2023-11-22",
    endDate: "2023-11-23",
  });
  expect(pause.status).toBe(201);
  const pauseId: string = pause.json.data.id;
  for (const who of ["victor", "carla"]) {
    const res = await call("PUT", `/pause-requests/${pauseId}/response`, who, {
      decision: "approve",
    });
    expect([who, res.status]).toEqual([who, 200]);
  }
  setNow(day(10) as never);

  const members = await call("GET", "/me/circle", "victor");
  const idOf = (name: string): string =>
    members.json.data.circle.members.find((m: { displayName: string }) => m.displayName === name)
      .id;
  return {
    ...ctx,
    circleId,
    seasonId,
    pauseId,
    ids: { andrea: idOf("Creator"), victor: idOf("Victor"), carla: idOf("Carla") },
    secret,
    photoId,
    objectKey,
    entryId,
    reactionPath: (key: string) => `/seasons/${seasonId}/feed/${encodeURIComponent(key)}/reaction`,
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** Everything that identifies or describes Andrea's private facts, or the internals of the social tables. */
function assertClean(label: string, json: unknown, w: World, alsoAbsent: readonly string[] = []) {
  const text = JSON.stringify(json);
  for (const secret of [
    ...alsoAbsent,
    SENTINEL_HABIT,
    SENTINEL_NOTE,
    SENTINEL_PAUSE_NOTE,
    QUANTITY,
    w.photoId,
    w.objectKey,
    w.entryId,
    // The commitment id is part of an item key by design (F3) and is not asserted absent.
    ANDREA,
    VICTOR,
    CARLA,
    "entry-photos",
  ]) {
    expect(text.includes(secret), `${label} leaks ${secret}`).toBe(false);
  }
  const leaked = keysOf(json).filter((k) => FORBIDDEN_KEYS.has(k));
  expect([label, leaked]).toEqual([label, []]);
}

describe("the social routes never carry Andrea's private facts or the social internals", () => {
  it("SO-P1: feed pages, reactions, the nudge, a send and a dismissal, for Victor and Carla", async () => {
    const w = await world();
    const { call, ids } = w;
    const seen: [string, unknown][] = [];
    const record = (label: string, res: { json: unknown }) => {
      seen.push([label, res.json]);
      return res;
    };

    // Feed, both pages.
    for (const who of ["victor", "carla"]) {
      const first = record(`${who} GET /me/feed`, await call("GET", "/me/feed", who));
      expect(first.json).toMatchObject({ data: { nextCursor: expect.any(String) } });
      const cursor = (first.json as { data: { nextCursor: string } }).data.nextCursor;
      const second = record(`${who} GET after`, await call("GET", `/me/feed/after/${cursor}`, who));
      expect(second.json).toMatchObject({ data: { nudge: null } });
    }

    const victorFeed = (await call("GET", "/me/feed", "victor")).json.data;
    const items: { kind: string; key: string; subject?: unknown; subjects?: unknown[] }[] = [
      ...victorFeed.items,
      ...(await call("GET", `/me/feed/after/${victorFeed.nextCursor}`, "victor")).json.data.items,
    ];

    // Andrea's private session: a private subject with no value; her pause: private subjects, no reason.
    const privateSession = items.find((i) => i.key === `session:${w.secret.commitmentId}:1`);
    expect(privateSession).toMatchObject({
      kind: "completed",
      subject: { kind: "private" },
      value: null,
    });
    const paused = items.find((i) => i.kind === "paused");
    expect(paused).toMatchObject({ subjects: [{ kind: "private" }], reason: null });
    const recalc = items.find((i) => i.kind === "pointsRecalculated");
    expect(recalc).toMatchObject({ subjects: [{ kind: "private" }] });
    // Her hard week is not a feed item at all, and the nudge about it is a private subject.
    expect(victorFeed.nudge).toEqual({
      seasonId: w.seasonId,
      targetId: ids.andrea,
      week: 1,
      subject: { kind: "private" },
    });

    // Reactions, by both peers on the same items: counts only.
    const targets = [`session:${w.secret.commitmentId}:1`, `pause:${w.pauseId}`];
    for (const key of targets) {
      const v = record(
        "victor PUT",
        await call("PUT", w.reactionPath(key), "victor", { emoji: "fire" }),
      );
      const c = record(
        "carla PUT",
        await call("PUT", w.reactionPath(key), "carla", { emoji: "heart" }),
      );
      expect(v.json).toMatchObject({ data: { mine: "fire", reactable: true } });
      expect(c.json).toEqual({
        data: {
          counts: { heart: 1, raisedHands: 0, fire: 1, clap: 0 },
          mine: "heart",
          reactable: true,
        },
      });
    }
    record("carla DELETE", await call("DELETE", w.reactionPath(targets[1] ?? ""), "carla"));

    // Carla dismisses; Victor's own suggestion is untouched, then he encourages Andrea.
    record(
      "carla dismiss",
      await call("POST", `/seasons/${w.seasonId}/nudge-dismissals`, "carla", {
        targetId: ids.andrea,
        week: 1,
      }),
    );
    const victorAgain = record("victor GET /me/feed", await call("GET", "/me/feed", "victor"));
    expect(victorAgain.json).toMatchObject({ data: { nudge: { targetId: ids.andrea } } });
    const sent = record(
      "victor send",
      await call("POST", `/seasons/${w.seasonId}/encouragements`, "victor", {
        recipientId: ids.andrea,
        week: 1,
        emoji: "raisedHands",
      }),
    );
    expect(sent.json).toEqual({ data: { recipientId: ids.andrea, week: 1 } });

    // Carla never sees Victor's encouragement; Victor never sees Carla's dismissal; Andrea sees hers.
    const carlaFeed = record("carla GET /me/feed", await call("GET", "/me/feed", "carla"));
    const carlaText = JSON.stringify(carlaFeed.json);
    expect(carlaText).not.toContain("encouragement");
    expect((carlaFeed.json as { data: { nudge: unknown } }).data.nudge).toBeNull();
    const victorLast = record("victor GET /me/feed", await call("GET", "/me/feed", "victor"));
    expect((victorLast.json as { data: { nudge: unknown } }).data.nudge).toBeNull();
    expect(JSON.stringify(victorLast.json)).not.toContain("encouragement");
    const andreaFeed = (await call("GET", "/me/feed", "andrea")).json.data.items.filter(
      (i: { kind: string }) => i.kind === "encouragementReceived",
    );
    expect(andreaFeed).toHaveLength(1);

    // Reactions show counts only, in the owner's own feed too.
    const ownerView = await call("GET", "/me/feed", "andrea");
    const ownerRest = await call(
      "GET",
      `/me/feed/after/${ownerView.json.data.nextCursor}`,
      "andrea",
    );
    const mine = [...ownerView.json.data.items, ...ownerRest.json.data.items].find(
      (i: { key: string }) => i.key === `session:${w.secret.commitmentId}:1`,
    );
    expect(mine.reactions).toEqual({
      counts: { heart: 1, raisedHands: 0, fire: 1, clap: 0 },
      mine: null,
      reactable: false,
    });

    for (const [label, json] of seen) assertClean(label, json, w);
    expect(seen.length).toBeGreaterThan(10);
  });

  it("SO-P2: the same reads after Andrea leaves, still clean, and her items stay but cannot be reacted to", async () => {
    const w = await world();
    const { call } = w;
    const left = await call("POST", `/circles/${w.circleId}/leave`, "andrea");
    expect(left.status).toBe(200);

    for (const who of ["victor", "carla"]) {
      const first = await call("GET", "/me/feed", who);
      expect(first.status).toBe(200);
      // Her real name is absent from every social response once she has left (ADR-0018).
      assertClean(`${who} GET /me/feed after leave`, first.json, w, ["Creator"]);
      expect(first.json.data.members.find((m: { id: string }) => m.id === w.ids.andrea)).toEqual({
        id: w.ids.andrea,
        displayName: null,
        isYou: false,
        left: true,
      });
      // Her hard week no longer yields a nudge: she is not a candidate once she has left.
      expect(first.json.data.nudge).toBeNull();
      const cursor: string = first.json.data.nextCursor;
      const second = await call("GET", `/me/feed/after/${cursor}`, who);
      assertClean(`${who} GET after`, second.json, w, ["Creator"]);

      const item = [...first.json.data.items, ...second.json.data.items].find(
        (i: { key: string }) => i.key === `session:${w.secret.commitmentId}:1`,
      );
      expect(item.reactions.reactable).toBe(false);
      expect(item.reactions.counts).toEqual({ heart: 0, raisedHands: 0, fire: 0, clap: 0 });
      const react = await call("PUT", w.reactionPath(item.key), who, { emoji: "fire" });
      expect([react.status, react.json.error.code]).toEqual([409, "FeedItemNotReactable"]);
      assertClean(`${who} PUT after leave`, react.json, w, ["Creator"]);
      const send = await call("POST", `/seasons/${w.seasonId}/encouragements`, who, {
        recipientId: w.ids.andrea,
        week: 1,
        emoji: "fire",
      });
      expect([send.status, send.json.error.code]).toEqual([409, "NudgeNotAvailable"]);
      assertClean(`${who} send after leave`, send.json, w, ["Creator"]);
    }
  });

  it.each([
    ["private", { kind: "private" }],
    ["visible", { kind: "habit", name: "Run andrea", icon: null }],
  ] as const)(
    "SO-P4: a real closure that graduates a %s habit reaches a peer as that subject only",
    async (privacy, subject) => {
      const { call, setNow, seasonId, commitmentIds } = await givenTwoMemberSeason(DONE, {
        andrea: privacy,
      });
      setNow(instant(Date.UTC(2023, 11, 12, 17)));
      const review = await call("POST", `/seasons/${seasonId}/reviews/4`, "andrea", {
        reflection: { helped: null, hard: null },
        automaticity: [{ commitmentId: commitmentIds.andrea, items: [4, 4, 5, 5] }],
      });
      expect(review.status).toBe(201);
      setNow(instant(Date.UTC(2023, 11, 13, 17, 41, 13, 777)));
      const closed = await call("POST", `/seasons/${seasonId}/closure`, "andrea", {
        decisions: [{ commitmentId: commitmentIds.andrea, decision: "graduate" }],
      });
      expect(closed.status).toBe(201);

      const feed = await call("GET", "/me/feed", "victor");
      const graduated = feed.json.data.items.filter(
        (i: { kind: string }) => i.kind === "graduated",
      );
      expect(graduated).toHaveLength(1);
      expect(graduated[0]).toMatchObject({ kind: "graduated", subject });
      // The wire carries the item and its subject, never the closure behind it.
      const text = JSON.stringify(feed.json);
      expect(text).not.toContain("decision");
      expect(text.includes("Run andrea")).toBe(privacy === "visible");
    },
  );

  it("SO-P3: errors never echo the private facts either (unknown item, wrong season)", async () => {
    const w = await world();
    const unknown = await w.call(
      "PUT",
      w.reactionPath(`session:${w.secret.commitmentId}:9`),
      "victor",
      { emoji: "fire" },
    );
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "FeedItemNotFound"]);
    expect(Object.keys(unknown.json.error).sort()).toEqual(["code", "message"]);
  });
});
