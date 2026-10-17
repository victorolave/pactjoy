import {
  ConcurrencyConflict,
  circleId,
  type EncouragementRepository,
  type FeedReactionRepository,
  instant,
  localDate,
  memberId,
  type NudgeDismissalRepository,
  ok,
  type Season,
  seasonId,
  timeZoneId,
} from "@pactjoy/app";
import {
  describeEncouragementRepositoryContract,
  describeFeedReactionRepositoryContract,
  describeNudgeDismissalRepositoryContract,
} from "@pactjoy/app/contracts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_791_987_120_000);
const CIRCLE = {
  id: circleId(uuid(0xc1)),
  name: "C",
  members: [],
  invite: null,
  createdAt: T0,
  archivedAt: null,
  version: 0,
};
const SEASON: Season = {
  id: seasonId(uuid(0xe1)),
  circleId: CIRCLE.id,
  timeZone: timeZoneId("America/Bogota"),
  nominalStart: localDate("2026-10-01"),
  actualStart: localDate("2026-10-01"),
  lengthWeeks: 4,
  reviewCadenceWeeks: 2,
  status: "active",
  commitments: [],
  approvals: [],
  pactClosedAt: null,
  pactRevision: 0,
  createdAt: T0,
  version: 0,
};
const VICTOR = memberId(uuid(0xa1));
const ANDREA = memberId(uuid(0xa2));
const ITEM = `session:${uuid(0xc01)}:3`;

const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
afterAll(async () => {
  await truncateAll(admin);
  await client.end();
  await admin.end();
});

const seedSeason = async () => {
  await uow.transaction(async ({ circles, seasons }) => {
    await circles.save(CIRCLE, null);
    await seasons.save(SEASON, null);
    return ok(undefined);
  });
};

/** The repositories as a use case sees them: every call in its own unit of work, errors mapped. */
const feedReactions: FeedReactionRepository = {
  listBySeason: (season) => uow.read(({ feedReactions: r }) => r.listBySeason(season)),
  find: (season, key, member) => uow.read(({ feedReactions: r }) => r.find(season, key, member)),
  save: async (reaction, expectedVersion) => {
    await uow.transaction(async ({ feedReactions: r }) => {
      await r.save(reaction, expectedVersion);
      return ok(undefined);
    });
  },
  remove: async (id, expectedVersion) => {
    await uow.transaction(async ({ feedReactions: r }) => {
      await r.remove(id, expectedVersion);
      return ok(undefined);
    });
  },
};
const encouragements: EncouragementRepository = {
  listSent: (season, sender) => uow.read(({ encouragements: r }) => r.listSent(season, sender)),
  listReceived: (season, recipient) =>
    uow.read(({ encouragements: r }) => r.listReceived(season, recipient)),
  get: (id) => uow.read(({ encouragements: r }) => r.get(id)),
  add: async (encouragement) => {
    await uow.transaction(async ({ encouragements: r }) => {
      await r.add(encouragement);
      return ok(undefined);
    });
  },
};
const nudgeDismissals: NudgeDismissalRepository = {
  listMine: (season, viewer) => uow.read(({ nudgeDismissals: r }) => r.listMine(season, viewer)),
  add: async (dismissal) => {
    await uow.transaction(async ({ nudgeDismissals: r }) => {
      await r.add(dismissal);
      return ok(undefined);
    });
  },
};

describeFeedReactionRepositoryContract("postgres", async () => {
  await truncateAll(admin);
  return { repository: feedReactions, seedSeason };
});
describeEncouragementRepositoryContract("postgres", async () => {
  await truncateAll(admin);
  return { repository: encouragements, seedSeason };
});
describeNudgeDismissalRepositoryContract("postgres", async () => {
  await truncateAll(admin);
  return { repository: nudgeDismissals, seedSeason };
});

beforeEach(async () => {
  await truncateAll(admin);
  await seedSeason();
});

const violates = async (run: () => PromiseLike<unknown>, constraint: string) => {
  const error = await Promise.resolve(run()).then(
    () => null,
    (e: unknown) => e as { code?: string; constraint_name?: string },
  );
  expect(error).toMatchObject({ code: expect.stringMatching(/^23/), constraint_name: constraint });
};

const insertReaction = (extra: Record<string, unknown> = {}) => {
  const row = {
    id: uuid(0x700),
    season_id: SEASON.id,
    item_key: ITEM,
    member_id: VICTOR,
    emoji: "heart",
    reacted_at: "2026-10-14T14:12:00Z",
    version: 0,
    ...extra,
  };
  return admin`insert into pactjoy.feed_reactions ${admin(row)}`;
};
const insertEncouragement = (extra: Record<string, unknown> = {}) => {
  const row = {
    id: uuid(0x800),
    season_id: SEASON.id,
    sender_member_id: VICTOR,
    recipient_member_id: ANDREA,
    case_week: 2,
    emoji: "raisedHands",
    sent_at: "2026-10-14T14:12:00Z",
    sent_on: "2026-10-14",
    ...extra,
  };
  return admin`insert into pactjoy.encouragements ${admin(row)}`;
};
const insertDismissal = (extra: Record<string, unknown> = {}) => {
  const row = {
    season_id: SEASON.id,
    viewer_member_id: VICTOR,
    target_member_id: ANDREA,
    case_week: 2,
    dismissed_at: "2026-10-14T14:12:00Z",
    dismissed_on: "2026-10-14",
    ...extra,
  };
  return admin`insert into pactjoy.nudge_dismissals ${admin(row)}`;
};

describe("pactjoy.feed_reactions constraints", () => {
  it("SOC-DB1: the emoji is one of the four codes and version is not negative", async () => {
    for (const [i, emoji] of ["heart", "raisedHands", "fire", "clap"].entries()) {
      await insertReaction({ id: uuid(0x710 + i), emoji, member_id: uuid(0xb00 + i) });
    }
    await violates(
      () => insertReaction({ id: uuid(0x720), emoji: "👏" }),
      "feed_reactions_emoji_check",
    );
    await violates(
      () => insertReaction({ id: uuid(0x721), emoji: "thumbsUp" }),
      "feed_reactions_emoji_check",
    );
    await violates(
      () => insertReaction({ id: uuid(0x722), version: -1 }),
      "feed_reactions_version_check",
    );
  });

  it("SOC-DB2: the item key has the pinned shape and at most 120 characters", async () => {
    const ok120 = `session:${"a".repeat(111)}`;
    expect(ok120).toHaveLength(119);
    for (const [i, key] of [
      ok120,
      `week:${uuid(0xc01)}:12`,
      `season-start:${uuid(0xe1)}`,
      "session:commitment-meditar:3",
    ].entries()) {
      await insertReaction({ id: uuid(0x730 + i), item_key: key });
    }
    for (const [i, key] of [
      "",
      "session",
      "Session:abc",
      "session:",
      "session::3",
      "session:a b",
      "session:a_b",
      `session:${"a".repeat(120)}`,
    ].entries()) {
      await violates(
        () => insertReaction({ id: uuid(0x740 + i), item_key: key }),
        "feed_reactions_item_key_check",
      );
    }
  });

  it("SOC-DB3: (season, item, member) is unique, the id is the key, and the season FK is RESTRICT", async () => {
    await insertReaction();
    await violates(
      () => insertReaction({ id: uuid(0x701) }),
      "feed_reactions_season_item_member_key",
    );
    await violates(() => insertReaction({ member_id: uuid(0xa2) }), "feed_reactions_pkey");
    await insertReaction({ id: uuid(0x702), member_id: uuid(0xa2) });
    await insertReaction({ id: uuid(0x703), item_key: `week:${uuid(0xc01)}:1` });
    await violates(
      () => insertReaction({ id: uuid(0x704), season_id: uuid(0xdead), member_id: uuid(0xa3) }),
      "feed_reactions_season_id_fkey",
    );
    await violates(
      () => admin`delete from pactjoy.seasons where id = ${SEASON.id}`,
      "feed_reactions_season_id_fkey",
    );
  });
});

describe("pactjoy.encouragements constraints", () => {
  it("SOC-DB4: emoji, case week 1..12 and sender <> recipient are checked", async () => {
    await violates(() => insertEncouragement({ emoji: "poop" }), "encouragements_emoji_check");
    await violates(() => insertEncouragement({ case_week: 0 }), "encouragements_case_week_check");
    await violates(() => insertEncouragement({ case_week: 13 }), "encouragements_case_week_check");
    await violates(
      () => insertEncouragement({ recipient_member_id: VICTOR }),
      "encouragements_sender_recipient_check",
    );
    await insertEncouragement({ id: uuid(0x801), case_week: 1, sent_on: "2026-10-01" });
    await insertEncouragement({ id: uuid(0x802), case_week: 12, sent_on: "2026-10-02" });
  });

  it("SOC-DB5: one per case and one per person per day, each its own named key", async () => {
    await insertEncouragement();
    // Same case, another day.
    await violates(
      () => insertEncouragement({ id: uuid(0x801), sent_on: "2026-10-15" }),
      "encouragements_case_key",
    );
    // Another case, same person and day.
    await violates(
      () => insertEncouragement({ id: uuid(0x802), case_week: 3 }),
      "encouragements_daily_key",
    );
    await violates(
      () => insertEncouragement({ case_week: 3, sent_on: "2026-10-15" }),
      "encouragements_pkey",
    );
    // Another recipient, another sender and another season-case are all independent.
    await insertEncouragement({ id: uuid(0x803), recipient_member_id: uuid(0xa3) });
    await insertEncouragement({
      id: uuid(0x804),
      sender_member_id: ANDREA,
      recipient_member_id: VICTOR,
    });
  });

  it("SOC-DB6: the season FK is RESTRICT", async () => {
    await violates(
      () => insertEncouragement({ season_id: uuid(0xdead) }),
      "encouragements_season_id_fkey",
    );
    await insertEncouragement();
    await violates(
      () => admin`delete from pactjoy.seasons where id = ${SEASON.id}`,
      "encouragements_season_id_fkey",
    );
  });
});

describe("pactjoy.nudge_dismissals constraints", () => {
  it("SOC-DB7: the case is the primary key, the week is 1..12 and the season FK is RESTRICT", async () => {
    await insertDismissal();
    await violates(() => insertDismissal(), "nudge_dismissals_pkey");
    await violates(() => insertDismissal({ case_week: 0 }), "nudge_dismissals_case_week_check");
    await violates(() => insertDismissal({ case_week: 13 }), "nudge_dismissals_case_week_check");
    await insertDismissal({ case_week: 3 });
    await violates(
      () => insertDismissal({ season_id: uuid(0xdead) }),
      "nudge_dismissals_season_id_fkey",
    );
    await violates(
      () => admin`delete from pactjoy.seasons where id = ${SEASON.id}`,
      "nudge_dismissals_season_id_fkey",
    );
  });
});

describe("the social tables are closed to clients", () => {
  it("SOC-DB8: RLS is on with no policies, client roles hold nothing, and there are no triggers", async () => {
    for (const table of ["feed_reactions", "encouragements", "nudge_dismissals"]) {
      const [rls] =
        await admin`select relrowsecurity as on from pg_class where oid = ${`pactjoy.${table}`}::regclass`;
      const [policies] =
        await admin`select count(*)::int as n from pg_policies where schemaname = 'pactjoy' and tablename = ${table}`;
      const [triggers] =
        await admin`select count(*)::int as n from pg_trigger where tgrelid = ${`pactjoy.${table}`}::regclass and not tgisinternal`;
      expect({ table, rls: rls?.on, policies: policies?.n, triggers: triggers?.n }).toEqual({
        table,
        rls: true,
        policies: 0,
        triggers: 0,
      });
      for (const role of ["anon", "authenticated"]) {
        const [priv] =
          await admin`select has_table_privilege(${role}, ${`pactjoy.${table}`}, 'select, insert, update, delete') as held`;
        expect({ table, role, held: priv?.held }).toEqual({ table, role, held: false });
      }
    }
    const [fns] =
      await admin`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pactjoy'`;
    expect(fns?.n).toBe(0);
  });

  it("SOC-DB9: no foreign key points at a member or a commitment (E can delete or anonymize freely)", async () => {
    const rows = await admin`
      select conrelid::regclass::text as tbl, confrelid::regclass::text as target
      from pg_constraint
      where contype = 'f' and conrelid::regclass::text in
        ('pactjoy.feed_reactions', 'pactjoy.encouragements', 'pactjoy.nudge_dismissals')`;
    expect(rows.map((r) => `${r.tbl}->${r.target}`).sort()).toEqual([
      "pactjoy.encouragements->pactjoy.seasons",
      "pactjoy.feed_reactions->pactjoy.seasons",
      "pactjoy.nudge_dismissals->pactjoy.seasons",
    ]);
  });
});

describe("the Postgres social repositories", () => {
  const reaction = (n: number) => ({
    id: uuid(0x900 + n) as never,
    seasonId: SEASON.id,
    itemKey: ITEM,
    memberId: VICTOR,
    emoji: "fire" as const,
    reactedAt: instant(1_791_987_120_000 + n),
    version: 0,
  });

  it("SOC-DB10: concurrent first reactions of one member to one item store one row, the losers are a ConcurrencyConflict", async () => {
    const settled = await Promise.allSettled([
      feedReactions.save(reaction(1), null),
      feedReactions.save(reaction(2), null),
      feedReactions.save(reaction(3), null),
    ]);
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(ConcurrencyConflict);
    const [n] = await admin`select count(*)::int as n from pactjoy.feed_reactions`;
    expect(n?.n).toBe(1);
  });

  it("SOC-DB11: concurrent dismissals of one case never fail and keep the first", async () => {
    const dismissal = (n: number) => ({
      seasonId: SEASON.id,
      viewerId: VICTOR,
      targetId: ANDREA,
      caseWeek: 2,
      dismissedAt: instant(1_791_987_120_000 + n),
      dismissedOn: localDate("2026-10-14"),
    });
    await Promise.all([1, 2, 3].map((n) => nudgeDismissals.add(dismissal(n))));
    const [n] = await admin`select count(*)::int as n from pactjoy.nudge_dismissals`;
    expect(n?.n).toBe(1);
  });
});
