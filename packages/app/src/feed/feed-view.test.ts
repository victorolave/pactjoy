import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { buildCommitment } from "../commitment/commitment.ts";
import { feedReactionId } from "../shared/ids.ts";
import { feedReactionFixture, habitFixture } from "../testing/builders.ts";
import { localInstant } from "../testing/entry-fixtures.ts";
import { deriveFeed } from "./derive-feed.ts";
import {
  ANDREA,
  ANDREA_USER,
  approvedPause,
  dateOf,
  feedCircle,
  feedWorld,
  HABITS,
  LEER,
  leer,
  MEDITAR,
  meditar,
  minutes,
  VICTOR,
  VICTOR_USER,
} from "./feed-fixtures.ts";
import type { FeedRecord } from "./feed-record.ts";
import { type FeedItemView, presentFeedItems } from "./feed-view.ts";

const SENTINEL_HABIT = "SENTINEL_HABIT";
const SENTINEL_LABEL = "SENTINEL_LABEL";

/** A private "Meditar" whose habit name and custom unit label are sentinels. */
const EVERY_DAY = {
  period: "perSession",
  frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
} as const;

const privateMeditar = () =>
  buildCommitment({
    ...meditar(),
    privacy: "private",
    measure: {
      unit: "custom",
      customLabel: SENTINEL_LABEL,
      precision: "decimal",
      target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
      schedule: EVERY_DAY,
    },
  });

const sentinelHabits = HABITS.map((habit) =>
  habit.id === "habit-meditar" ? habitFixture({ ...habit, name: SENTINEL_HABIT }) : habit,
);

function present(
  records: readonly FeedRecord[],
  options: {
    readonly viewer?: "andrea" | "victor";
    readonly left?: Parameters<typeof feedCircle>[0];
    readonly world?: ReturnType<typeof feedWorld>;
    readonly reactions?: Parameters<typeof presentFeedItems>[0]["reactions"];
  } = {},
): FeedItemView[] {
  const world = options.world ?? feedWorld();
  const circle = feedCircle(options.left ?? {});
  const viewer = circle.members.find(
    (m) => m.userId === (options.viewer === "andrea" ? ANDREA_USER : VICTOR_USER),
  );
  if (!viewer) throw new Error("no viewer");
  return presentFeedItems({
    records,
    season: world.season,
    circle,
    habits: world.habits,
    viewer,
    reactions: options.reactions ?? [],
  });
}

const json = (value: unknown) => JSON.stringify(value);

describe("presentFeedItems: subjects and values (F8, F9)", () => {
  const completedWorld = (commitment = meditar(), habits = HABITS) =>
    feedWorld({
      commitments: [commitment, leer()],
      habits,
      entries: [minutes(commitment, 0, "30")],
      today: 1,
    });

  it("a peer sees a visible commitment's name, icon and value", () => {
    const world = completedWorld();
    const [item] = present(
      deriveFeed(world).filter((r) => r.kind === "completed"),
      { world },
    );
    expect(item).toMatchObject({
      kind: "completed",
      memberId: ANDREA,
      subject: { kind: "habit", name: "Meditar", icon: "leaf" },
      value: { amount: "30", unit: "minutes", customLabel: null },
    });
  });

  it("a peer sees a private commitment as a private subject with no value, and nothing leaks", () => {
    const world = completedWorld(privateMeditar(), sentinelHabits);
    const items = present(deriveFeed(world), { world });
    const completed = items.find((i) => i.kind === "completed");
    expect(completed).toMatchObject({ subject: { kind: "private" }, value: null });
    expect(json(items)).not.toContain(SENTINEL_HABIT);
    expect(json(items)).not.toContain(SENTINEL_LABEL);
    expect(json(items)).not.toContain("custom");
  });

  it("the owner sees their own private commitment in full", () => {
    const world = completedWorld(privateMeditar(), sentinelHabits);
    const completed = present(deriveFeed(world), { world, viewer: "andrea" }).find(
      (i) => i.kind === "completed",
    );
    expect(completed).toMatchObject({
      subject: { kind: "habit", name: SENTINEL_HABIT },
      value: { amount: "30", unit: "custom", customLabel: SENTINEL_LABEL },
    });
  });

  it("a habit that cannot be found falls back to a private subject", () => {
    const world = completedWorld(meditar(), []);
    const completed = present(deriveFeed(world), { world }).find((i) => i.kind === "completed");
    expect(completed).toMatchObject({ subject: { kind: "private" } });
  });

  it("a done commitment carries no value even when visible", () => {
    const done = buildCommitment({
      ...meditar(),
      measure: { unit: "done", schedule: EVERY_DAY },
    });
    const world = completedWorld(done);
    const completed = present(deriveFeed(world), { world }).find((i) => i.kind === "completed");
    expect(completed).toMatchObject({ value: null });
  });
});

describe("presentFeedItems: week counts (F9)", () => {
  const week = (commitment: ReturnType<typeof meditar>) =>
    feedWorld({
      commitments: [commitment],
      entries: [0, 1, 2, 3, 4, 5, 6].map((d) => minutes(commitment, d, "30")),
      today: 8,
    });

  it("shows kept and counted on a visible commitment", () => {
    const world = week(meditar());
    const item = present(deriveFeed(world), { world }).find((i) => i.kind === "consistentWeek");
    expect(item).toMatchObject({ week: 1, kept: 7, counted: 7, subject: { name: "Meditar" } });
  });

  it("hides the counts on a private commitment but still names the week", () => {
    const world = week(privateMeditar());
    const item = present(deriveFeed(world), { world }).find((i) => i.kind === "consistentWeek");
    expect(item).toMatchObject({
      week: 1,
      kept: null,
      counted: null,
      subject: { kind: "private" },
    });
  });
});

describe("presentFeedItems: pauses (F7)", () => {
  const both = approvedPause({
    reason: "health",
    commitments: [
      { commitmentId: MEDITAR, resumedOn: null, resumedAt: null },
      { commitmentId: LEER, resumedOn: null, resumedAt: null },
    ],
  });

  it("masks each subject on its own and keeps the reason while one is visible", () => {
    const world = feedWorld({
      commitments: [privateMeditar(), leer()],
      habits: sentinelHabits,
      requests: [both],
    });
    const items = present(deriveFeed(world), { world });
    expect(items.find((i) => i.kind === "paused")).toMatchObject({
      subjects: [{ kind: "private" }, { kind: "habit", name: "Leer" }],
      reason: "health",
    });
    expect(items.find((i) => i.kind === "pointsRecalculated")).toMatchObject({
      subjects: [{ kind: "private" }, { kind: "habit", name: "Leer" }],
    });
    expect(json(items)).not.toContain(SENTINEL_HABIT);
  });

  it("drops the reason when every subject is private", () => {
    const world = feedWorld({
      commitments: [privateMeditar(), leer({ privacy: "private" })],
      requests: [both],
    });
    const paused = present(deriveFeed(world), { world }).find((i) => i.kind === "paused");
    expect(paused).toMatchObject({
      subjects: [{ kind: "private" }, { kind: "private" }],
      reason: null,
    });
  });

  it("the owner still sees the reason and every name of their own pause", () => {
    const world = feedWorld({
      commitments: [privateMeditar(), leer({ privacy: "private" })],
      requests: [both],
    });
    const paused = present(deriveFeed(world), { world, viewer: "andrea" }).find(
      (i) => i.kind === "paused",
    );
    expect(paused).toMatchObject({ reason: "health" });
  });

  it("never exposes the pause note", () => {
    const world = feedWorld({ requests: [approvedPause({ note: "SENTINEL_PAUSE_NOTE" })] });
    expect(json(present(deriveFeed(world), { world }))).not.toContain("SENTINEL_PAUSE_NOTE");
  });
});

describe("presentFeedItems: graduation (F8)", () => {
  const graduatedHabits = HABITS.map((h) =>
    h.id === "habit-leer" ? habitFixture({ ...h, graduatedAt: localInstant(dateOf(10)) }) : h,
  );

  it("names a visible habit and masks a private one for peers", () => {
    const visible = feedWorld({ habits: graduatedHabits });
    expect(
      present(deriveFeed(visible), { world: visible }).find((i) => i.kind === "graduated"),
    ).toMatchObject({ memberId: ANDREA, subject: { kind: "habit", name: "Leer" } });

    const hidden = feedWorld({
      commitments: [meditar(), leer({ privacy: "private" })],
      habits: graduatedHabits,
    });
    expect(
      present(deriveFeed(hidden), { world: hidden }).find((i) => i.kind === "graduated"),
    ).toMatchObject({ subject: { kind: "private" } });
  });
});

describe("presentFeedItems: reactions (F12)", () => {
  const world = feedWorld({ entries: [minutes(meditar(), 0, "30")], today: 1 });
  const records = deriveFeed(world);
  const key = `session:${MEDITAR}:1`;
  const reaction = (id: string, by: typeof VICTOR, emoji: "fire" | "clap") =>
    feedReactionFixture({ id: feedReactionId(id), itemKey: key, memberId: by, emoji });

  it("shows counts and the viewer's own mark, and the item is reactable by a peer", () => {
    const items = present(records, {
      world,
      reactions: [reaction("r1", VICTOR, "fire"), reaction("r2", ANDREA, "clap")],
    });
    const completed = items.find((i) => i.kind === "completed");
    expect(completed).toMatchObject({
      reactions: {
        counts: { heart: 0, raisedHands: 0, fire: 1, clap: 1 },
        mine: "fire",
        reactable: true,
      },
    });
  });

  it("an item of the viewer is not reactable, but its counts show", () => {
    const completed = present(records, {
      world,
      viewer: "andrea",
      reactions: [reaction("r1", VICTOR, "fire")],
    }).find((i) => i.kind === "completed");
    expect(completed).toMatchObject({ reactions: { reactable: false, mine: null } });
    expect(completed).toMatchObject({ reactions: { counts: { fire: 1 } } });
  });

  it("an item of a member who left is not reactable and shows no counts", () => {
    const completed = present(records, {
      world,
      left: { andrea: true },
      reactions: [reaction("r1", VICTOR, "fire")],
    }).find((i) => i.kind === "completed");
    expect(completed).toMatchObject({
      reactions: {
        counts: { heart: 0, raisedHands: 0, fire: 0, clap: 0 },
        mine: null,
        reactable: false,
      },
    });
  });

  it("hides the reactions of a reactor who left", () => {
    const completed = present(records, {
      world,
      viewer: "andrea",
      left: { victor: true },
      reactions: [reaction("r1", VICTOR, "fire")],
    }).find((i) => i.kind === "completed");
    expect(completed).toMatchObject({ reactions: { counts: { fire: 0 } } });
  });

  it("system items and the recalculation carry no reactions", () => {
    const paused = feedWorld({ requests: [approvedPause()] });
    const items = present(deriveFeed(paused), { world: paused });
    for (const kind of ["seasonStarted", "pointsRecalculated"]) {
      const item = items.find((i) => i.kind === kind);
      expect(item).toBeDefined();
      expect(item && "reactions" in item).toBe(false);
    }
  });

  it("a pause and a comeback are reactable", () => {
    const comeback = feedWorld({
      commitments: [meditar()],
      entries: [minutes(meditar(), 0, "30"), minutes(meditar(), 5, "30")],
      today: 6,
    });
    const paused = feedWorld({ requests: [approvedPause()] });
    const cases = [
      ["comeback", present(deriveFeed(comeback), { world: comeback })],
      ["paused", present(deriveFeed(paused), { world: paused })],
    ] as const;
    for (const [kind, items] of cases) {
      expect(items.find((i) => i.kind === kind)).toMatchObject({ reactions: { reactable: true } });
    }
  });

  it("passes through ids, dates and the season items untouched", () => {
    const items = present(deriveFeed(world), { world });
    expect(items.find((i) => i.kind === "seasonStarted")).toEqual({
      kind: "seasonStarted",
      key: "season-start:season-1",
      onDate: dateOf(0),
      at: null,
      lengthWeeks: 4,
    });
  });
});
