import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { databaseUrl } from "./db.ts";

describe("createClient against Postgres", () => {
  const client = createClient({ url: databaseUrl(), max: 2 });
  afterAll(() => client.end());

  const select = (text: string, params: unknown[] = []) =>
    client.begin(
      "isolation level read committed",
      async (tx) => (await tx.query(text, params)).rows,
    );

  it("returns timestamptz as exact Instant ms, date as a raw string and int8 as bigint", async () => {
    const [row] = await select(
      "select '2026-09-30 16:49:48.789123+00'::timestamptz as t, '2026-09-30'::date as d, 9007199254740993::int8 as n",
    );

    expect(row).toEqual({
      t: Date.UTC(2026, 8, 30, 16, 49, 48, 789),
      d: "2026-09-30",
      n: 9007199254740993n,
    });
  });

  it("parses correctly under a non-UTC session time zone", async () => {
    const rows = await client.begin("isolation level read committed", async (tx) => {
      await tx.query("set local timezone = 'America/Bogota'", []);
      return (await tx.query("select '2026-09-30 16:49:48.789+00'::timestamptz as t", [])).rows;
    });

    expect(rows[0]).toEqual({ t: Date.UTC(2026, 8, 30, 16, 49, 48, 789) });
  });

  it("binds $n parameters as text with explicit casts", async () => {
    const [row] = await select("select $1::int8 as n, $2::date as d", [
      "9007199254740993",
      "2026-02-28",
    ]);

    expect(row).toEqual({ n: 9007199254740993n, d: "2026-02-28" });
  });

  it("rolls back when the work throws, and surfaces the driver's code and constraint_name", async () => {
    const error = await client
      .begin("isolation level read committed", async (tx) => {
        await tx.query("create temp table t (id int constraint t_pkey primary key)", []);
        await tx.query("insert into t values (1)", []);
        await tx.query("insert into t values (1)", []);
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "23505", constraint_name: "t_pkey" });
  });
});
