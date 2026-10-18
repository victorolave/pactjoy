import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERASURE_COVERAGE,
  type ErasureEntry,
  findCoverageGaps,
  SEEDED_TABLES,
  scanMigrations,
} from "./erasure-coverage.ts";

const MIGRATIONS = resolve(import.meta.dirname, "../../../supabase/migrations");
const migrations = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"));

const entry = (rule: ErasureEntry["rule"] = "keep"): ErasureEntry => ({
  rule,
  how: "fixture",
  reason: "fixture",
});

const FIXTURE_CREATE = `
-- It's a comment with an apostrophe and a 'quote.
create table pactjoy.things (
  id uuid constraint things_pkey primary key,
  owner_id uuid not null,
  label text not null, -- another one, with a comma
  mood text not null
    constraint things_mood_check check (mood in ('a', 'b')),
  kind text constraint things_kind_check check (kind = 'x'),
  payload jsonb not null,
  tags varchar(20),
  created_at timestamptz not null,
  constraint things_shape check ((label = 'q') = (owner_id is null))
);
`;

describe("scanMigrations", () => {
  it("reads every column of a create table, with its type and whether an inline check pins its values", () => {
    const columns = scanMigrations([FIXTURE_CREATE]);

    expect(columns.map((c) => `${c.table}.${c.column}:${c.type}:${c.enumChecked}`)).toEqual([
      "things.id:uuid:false",
      "things.owner_id:uuid:false",
      "things.label:text:false",
      "things.mood:text:true",
      "things.kind:text:true",
      "things.payload:jsonb:false",
      "things.tags:varchar:false",
      "things.created_at:timestamptz:false",
    ]);
  });

  it("reads every added column of an alter table, several actions in one statement included", () => {
    const columns = scanMigrations([
      FIXTURE_CREATE,
      `alter table pactjoy.things
         add column reactor_id uuid
           constraint things_reactor_fkey references pactjoy.others (id) on delete restrict
           constraint things_reactor_key unique,
         add constraint things_reactor_shape check (not (label is null) or reactor_id is null),
         add column nickname text;
       alter table pactjoy.things add column if not exists bio text not null default '';`,
    ]);

    expect(
      columns
        .filter((c) => ["reactor_id", "nickname", "bio"].includes(c.column))
        .map((c) => `${c.table}.${c.column}:${c.type}`),
    ).toEqual(["things.reactor_id:uuid", "things.nickname:text", "things.bio:text"]);
  });

  it("marks a column enum-checked by a later constraint too, and ignores alters that add no column", () => {
    const columns = scanMigrations([
      FIXTURE_CREATE,
      `alter table pactjoy.things
         add column state text,
         add constraint things_state_check check (state in ('on', 'off'));
       alter table pactjoy.things drop constraint things_mood_check;
       alter table pactjoy.things enable row level security;`,
    ]);

    expect(columns.find((c) => c.column === "state")?.enumChecked).toBe(true);
    expect(columns.filter((c) => c.table === "things")).toHaveLength(9);
  });
});

describe("findCoverageGaps", () => {
  const columns = scanMigrations([FIXTURE_CREATE]);
  const complete = {
    "things.owner_id": entry(),
    "things.label": entry(),
    "things.payload": entry(),
    "things.tags": entry(),
  };
  const seeded = new Set(["things"]);

  it("reports nothing when every person column and every free-text column is registered and seeded", () => {
    expect(findCoverageGaps(columns, complete, seeded)).toEqual({
      missing: [],
      stale: [],
      unseeded: [],
    });
  });

  it("reports an unregistered person column, free-text column and column added by an alter", () => {
    const grown = scanMigrations([
      FIXTURE_CREATE,
      `alter table pactjoy.things add column reactor_id uuid, add column bio text;`,
    ]);

    expect(findCoverageGaps(grown, complete, seeded).missing).toEqual([
      "things.reactor_id",
      "things.bio",
    ]);
  });

  it("reports each person-named uuid shape, and lets a pinned enum or a plain id through", () => {
    const named = scanMigrations([
      `create table pactjoy.t (
         viewer_member_id uuid not null,
         created_by uuid not null,
         actor uuid,
         recipient_user_id uuid,
         season_id uuid not null,
         commitment_id uuid not null,
         status text not null check (status in ('x'))
       );`,
    ]);

    expect(findCoverageGaps(named, {}, new Set(["t"])).missing).toEqual([
      "t.viewer_member_id",
      "t.created_by",
      "t.actor",
      "t.recipient_user_id",
    ]);
  });

  it("reports a registry key that no migration defines", () => {
    const stale = { ...complete, "things.removed": entry(), "gone.owner_id": entry() };

    expect(findCoverageGaps(columns, stale, seeded).stale).toEqual([
      "things.removed",
      "gone.owner_id",
    ]);
  });

  it("reports a table with registered columns that the sentinel does not seed", () => {
    expect(findCoverageGaps(columns, complete, new Set()).unseeded).toEqual(["things"]);
  });
});

describe("the real migrations and ERASURE_COVERAGE (ADR-0019)", () => {
  const scanned = scanMigrations(migrations());
  const gaps = findCoverageGaps(scanned, ERASURE_COVERAGE, SEEDED_TABLES);

  it("registers every person column and every free-text column of every table", () => {
    expect(gaps.missing).toEqual([]);
  });

  it("holds no key that a migration does not define", () => {
    expect(gaps.stale).toEqual([]);
  });

  it("seeds every table that holds a registered column", () => {
    expect(gaps.unseeded).toEqual([]);
  });

  it("scans the whole schema, so a missing parser branch cannot hide a table", () => {
    const tables = new Set(scanned.map((c) => c.table));

    expect([...tables].sort()).toEqual(
      [
        "automaticity_responses",
        "circle_invites",
        "circle_members",
        "circles",
        "commitment_reminders",
        "encouragements",
        "entries",
        "entry_photos",
        "feed_reactions",
        "habits",
        "notification_outbox",
        "nudge_dismissals",
        "pause_request_commitments",
        "pause_requests",
        "pause_responses",
        "push_subscriptions",
        "reviews",
        "season_approvals",
        "season_closure_decisions",
        "season_closures",
        "season_commitments",
        "seasons",
      ].sort(),
    );
    expect(scanned.find((c) => c.table === "entries" && c.column === "photo_id")?.type).toBe(
      "uuid",
    );
    expect(
      scanned.find((c) => c.table === "circle_members" && c.column === "erased_at")?.type,
    ).toBe("timestamptz");
  });

  it("gives every entry a rule, a how and a reason", () => {
    const entries = Object.entries(ERASURE_COVERAGE);

    expect(entries.length).toBeGreaterThan(30);
    for (const [key, value] of entries) {
      expect(["delete", "anonymize", "keep"], key).toContain(value.rule);
      expect(value.how.trim().length, `${key} how`).toBeGreaterThan(0);
      expect(value.reason.trim().length, `${key} reason`).toBeGreaterThan(0);
    }
  });
});
