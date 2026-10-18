import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const admin = connect(databaseUrl());
afterAll(async () => {
  await truncateAll(admin);
  await admin.end();
});
beforeEach(async () => {
  await truncateAll(admin);
});

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const violates = async (run: () => PromiseLike<unknown>, constraint: string) => {
  const error = await Promise.resolve(run()).then(
    () => null,
    (e: unknown) => e as { code?: string; constraint_name?: string },
  );
  expect(error).toMatchObject({ code: expect.stringMatching(/^23/), constraint_name: constraint });
};

const insertReminder = (extra: Record<string, unknown> = {}) => {
  const row = {
    season_id: uuid(0xe1),
    commitment_id: uuid(0x601),
    member_id: uuid(0xa1),
    enabled: true,
    minute_of_day: 1200,
    weekdays: 0b0101010,
    updated_at: "2026-10-14T14:00:00Z",
    version: 1,
    ...extra,
  };
  return admin`insert into pactjoy.commitment_reminders ${admin(row)}`;
};

describe("pactjoy.commitment_reminders constraints (ADR-0017 addendum, D2)", () => {
  it("stores one row per season and commitment", async () => {
    await insertReminder();
    await violates(() => insertReminder({ member_id: uuid(0xa2) }), "commitment_reminders_pkey");
    await insertReminder({ season_id: uuid(0xe2) });
  });

  it("keeps the time on the 08:00-21:45 grid of 15 minutes", async () => {
    await insertReminder({ commitment_id: uuid(0x602), minute_of_day: 480 });
    await insertReminder({ commitment_id: uuid(0x603), minute_of_day: 1305 });
    for (const minute of [465, 1320, 1201]) {
      await violates(
        () => insertReminder({ commitment_id: uuid(0x610 + minute), minute_of_day: minute }),
        "commitment_reminders_minute_of_day_check",
      );
    }
  });

  it("weekdays is a 7-bit mask; an enabled reminder needs at least one day", async () => {
    await insertReminder({ commitment_id: uuid(0x602), weekdays: 127 });
    await insertReminder({ commitment_id: uuid(0x603), enabled: false, weekdays: 0 });
    await violates(
      () => insertReminder({ commitment_id: uuid(0x604), weekdays: 128 }),
      "commitment_reminders_weekdays_check",
    );
    await violates(
      () => insertReminder({ commitment_id: uuid(0x605), weekdays: 0 }),
      "commitment_reminders_enabled_weekdays_check",
    );
  });

  it("the version starts at 1", async () => {
    await violates(() => insertReminder({ version: 0 }), "commitment_reminders_version_check");
  });

  it("has no foreign key (orphan-tolerant, like the notification tables)", async () => {
    const fks = await admin`
      select conname from pg_constraint
      where contype = 'f' and conrelid = 'pactjoy.commitment_reminders'::regclass`;
    expect(fks).toEqual([]);
  });

  it("is closed to the client roles: RLS on, nothing granted", async () => {
    const [table] = await admin`
      select relrowsecurity from pg_class where oid = 'pactjoy.commitment_reminders'::regclass`;
    expect(table?.relrowsecurity).toBe(true);
    const grants = await admin`
      select grantee from information_schema.role_table_grants
      where table_schema = 'pactjoy' and table_name = 'commitment_reminders'
        and grantee in ('anon', 'authenticated', 'PUBLIC')`;
    expect(grants).toEqual([]);
  });
});

describe("pactjoy.notification_outbox accepts the reminder kind (D2)", () => {
  it("a commitmentReminder row is a valid kind", async () => {
    await admin`insert into pactjoy.notification_outbox ${admin({
      dedupe_key: "commitmentReminder:k",
      kind: "commitmentReminder",
      params: admin.json({
        seasonId: uuid(0xe1),
        commitmentId: uuid(0x601),
        forDate: "2026-10-14",
      }),
      circle_id: uuid(0xc1),
      season_id: uuid(0xe1),
      recipient_member_id: uuid(0xa1),
      recipient_user_id: uuid(0xb1),
      time_zone: "America/Bogota",
      not_before: "2026-10-15T01:00:00Z",
      expires_at: "2026-10-15T02:00:00Z",
      rollovers_left: 0,
      state: "pending",
      attempts: 0,
      lease_until: null,
      outcome: null,
      created_at: "2026-10-15T01:00:00Z",
      finished_at: null,
    })}`;
    const rows = await admin`select kind from pactjoy.notification_outbox`;
    expect(rows.map((row) => row.kind)).toEqual(["commitmentReminder"]);
  });
});
