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

describe("scanMigrations blind spots", () => {
  const typesOf = (columns: ReturnType<typeof scanMigrations>, table: string) =>
    columns.filter((c) => c.table === table).map((c) => `${c.column}:${c.type}`);

  it("reads a statement preceded by a block comment, whatever the comment holds", () => {
    const columns = scanMigrations([
      `/* The notes table.
          It's not a "real" one; a semicolon here -- or a dash pair -- is only text. */
       create table pactjoy.notes (id uuid, body text);
       /* inline */ alter /* between */ table pactjoy.notes add column mood text;`,
    ]);

    expect(typesOf(columns, "notes")).toEqual(["id:uuid", "body:text", "mood:text"]);
  });

  it("reads a statement preceded by a line comment and by a block comment in a row", () => {
    const columns = scanMigrations([
      `-- first
       /* second */
       create table pactjoy.notes (id uuid);`,
    ]);

    expect(typesOf(columns, "notes")).toEqual(["id:uuid"]);
  });

  it.each([
    [
      "a create table inside a DO block",
      "do $$ begin create table pactjoy.hidden (id uuid, note text); end $$;",
      /create table/i,
    ],
    [
      "an alter table inside a DO block",
      "do $$ begin alter table pactjoy.things add column bio text; end $$;",
      /alter table/i,
    ],
    [
      "a create table after another statement keyword",
      "begin create table pactjoy.hidden (id uuid, note text);",
      /create table/i,
    ],
    [
      "a create unlogged table that does not start the statement",
      "do $$ begin create unlogged table pactjoy.hidden (note text); end $$;",
      /does not start its statement.*unlogged table/i,
    ],
  ])("throws on %s instead of skipping it", (_name, statement, message) => {
    expect(() => scanMigrations([FIXTURE_CREATE, statement])).toThrow(message);
  });

  it("still ignores the words in a name or a string that are not a table statement", () => {
    const columns = scanMigrations([
      FIXTURE_CREATE,
      `comment on table pactjoy.things is 'a table';
       create index things_label_idx on pactjoy.things (label);
       grant select on table pactjoy.things to anon;`,
    ]);

    expect(columns.filter((c) => c.table === "things")).toHaveLength(8);
  });

  it("unpins a column when drop constraint removes the constraint that pinned it", () => {
    const pinned = (columns: ReturnType<typeof scanMigrations>, name: string) =>
      columns.find((c) => c.table === "things" && c.column === name)?.enumChecked;

    const afterDrop = scanMigrations([
      FIXTURE_CREATE,
      "alter table pactjoy.things drop constraint things_mood_check;",
    ]);
    expect(pinned(afterDrop, "mood")).toBe(false);
    expect(pinned(afterDrop, "kind")).toBe(true);

    const quotedIfExists = scanMigrations([
      FIXTURE_CREATE,
      'alter table pactjoy.things drop constraint if exists "things_kind_check" cascade;',
    ]);
    expect(pinned(quotedIfExists, "kind")).toBe(false);
    expect(pinned(quotedIfExists, "mood")).toBe(true);
  });

  it("unpins a column pinned by a later add constraint, and keeps the pin of an unrelated drop", () => {
    const columns = scanMigrations([
      FIXTURE_CREATE,
      `alter table pactjoy.things
         add column state text,
         add constraint things_state_check check (state in ('on', 'off'));
       alter table pactjoy.things drop constraint things_state_check;
       alter table pactjoy.things drop constraint things_shape;`,
    ]);

    expect(columns.find((c) => c.column === "state")?.enumChecked).toBe(false);
    expect(columns.find((c) => c.column === "mood")?.enumChecked).toBe(true);
  });

  it("unpins a column whose unnamed check carries Postgres' default name", () => {
    const columns = scanMigrations([
      `create table pactjoy.t (status text not null check (status in ('x')));
       alter table pactjoy.t drop constraint t_status_check;`,
    ]);

    expect(columns.find((c) => c.column === "status")?.enumChecked).toBe(false);
  });

  it("keeps a column pinned while another constraint still pins it", () => {
    const columns = scanMigrations([
      `create table pactjoy.t (
         status text not null constraint t_one check (status in ('x')),
         constraint t_two check (status in ('x', 'y'))
       );
       alter table pactjoy.t drop constraint t_one;`,
    ]);

    expect(columns.find((c) => c.column === "status")?.enumChecked).toBe(true);
  });

  it("does not carry a pin over to a column dropped and added back as free text", () => {
    const columns = scanMigrations([
      FIXTURE_CREATE,
      `alter table pactjoy.things drop column mood;
       alter table pactjoy.things add column mood text;`,
    ]);

    expect(columns.find((c) => c.column === "mood")).toMatchObject({
      type: "text",
      enumChecked: false,
    });
  });
});

describe("scanMigrations refuses what it cannot follow (a schema change must not bypass the registry)", () => {
  it.each([
    ["alter column ... type", "alter table pactjoy.things alter column label type varchar(10)"],
    [
      "alter ... type without the column keyword",
      "alter table pactjoy.things alter label type text",
    ],
    [
      "alter column ... set data type",
      "alter table pactjoy.things alter column payload set data type text",
    ],
    ["rename column", "alter table pactjoy.things rename column label to title"],
    ["rename to", "alter table pactjoy.things rename to others"],
    ["set schema", "alter table pactjoy.things set schema elsewhere"],
    [
      "an unknown action in a list",
      "alter table pactjoy.things add column ok text, inherit parent",
    ],
  ])("throws on %s", (_name, statement) => {
    expect(() => scanMigrations([FIXTURE_CREATE, statement])).toThrow(/things/);
  });

  it("throws on a table in another schema, or in none, instead of skipping it", () => {
    expect(() => scanMigrations(["create table other.things (id uuid, note text);"])).toThrow(
      /other\.things/,
    );
    expect(() => scanMigrations(["create table things (id uuid, note text);"])).toThrow(/things/);
    expect(() => scanMigrations(["alter table other.things add column bio text;"])).toThrow(
      /other\.things/,
    );
    expect(() => scanMigrations(["create table pactjoy.copy as select 1;"])).toThrow(/copy/);
  });

  it("follows the alters it understands: drop column removes it, not null and default change nothing", () => {
    const columns = scanMigrations([
      FIXTURE_CREATE,
      `alter table pactjoy.things
         drop column payload,
         alter column label set not null,
         alter column mood drop default,
         disable row level security;
       alter table pactjoy.things drop tags;`,
    ]);

    expect(columns.filter((c) => c.table === "things").map((c) => c.column)).toEqual([
      "id",
      "owner_id",
      "label",
      "mood",
      "kind",
      "created_at",
    ]);
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

  it("treats every type outside the numeric, time, boolean and uuid allowlist as free text", () => {
    const typed = scanMigrations([
      `create table pactjoy.t (
         a character varying not null,
         b json,
         c citext,
         d bytea,
         e inet,
         f text[],
         g char(3),
         h "text",
         i varchar(5) check (i in ('x')),
         j integer, k bigint, l numeric(5,2), m timestamptz, n timestamp with time zone,
         o boolean, p double precision, q date, r interval, s smallint, t uuid, u real
       );`,
    ]);

    expect(findCoverageGaps(typed, {}, new Set(["t"])).missing).toEqual([
      "t.a",
      "t.b",
      "t.c",
      "t.d",
      "t.e",
      "t.f",
      "t.g",
      "t.h",
    ]);
  });

  it("reports the wider person shapes: *_by, author, peer and participant", () => {
    const named = scanMigrations([
      `create table pactjoy.t (
         invited_by uuid, approved_by uuid, author_id uuid, peer_member_id uuid,
         participant uuid, standby_id uuid, season_id uuid
       );`,
    ]);

    expect(findCoverageGaps(named, {}, new Set(["t"])).missing).toEqual([
      "t.invited_by",
      "t.approved_by",
      "t.author_id",
      "t.peer_member_id",
      "t.participant",
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
