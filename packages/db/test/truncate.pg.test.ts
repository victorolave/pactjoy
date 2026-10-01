import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, databaseUrl, type Sql, truncateAll } from "./db.ts";

const HABIT = "00000000-0000-4000-8000-0000000000d1";

describe("truncateAll", () => {
  let sql: Sql;
  beforeAll(() => {
    sql = connect(databaseUrl());
  });
  afterAll(() => sql.end());

  const insertHabit = (id: string) =>
    sql.unsafe(
      `insert into pactjoy.habits (id, owner_id, name, created_at, version)
       values ('${id}', '${id}', 'x', now(), 0)`,
    );
  const count = async () =>
    (await sql.unsafe("select count(*)::int as n from pactjoy.habits"))[0]?.n;

  it("HM-S9: empties every table of the schema, so a test starts from a clean store", async () => {
    await insertHabit(HABIT);
    expect(await count()).toBe(1);

    await truncateAll(sql);

    expect(await count()).toBe(0);
    await insertHabit(HABIT); // the same id is free again
    await truncateAll(sql);
  });

  it("HM-S9: the next test sees nothing the previous one wrote", async () => {
    expect(await count()).toBe(0);
  });
});
