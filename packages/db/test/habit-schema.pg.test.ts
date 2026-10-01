import { describe, expect, it } from "vitest";
import { connect, databaseUrl } from "./db.ts";

describe("pactjoy.habits schema", () => {
  it("HP-S13: version is an integer NOT NULL, owner_id is a uuid with no foreign key, RLS is on", async () => {
    const sql = connect(databaseUrl());
    try {
      const columns = await sql.unsafe(
        `select column_name, data_type, is_nullable from information_schema.columns
          where table_schema = 'pactjoy' and table_name = 'habits'`,
      );
      const [fks] = await sql.unsafe(
        `select count(*)::int as n from pg_constraint
          where conrelid = 'pactjoy.habits'::regclass and contype = 'f'`,
      );
      const [rls] = await sql.unsafe(
        "select relrowsecurity as on from pg_class where oid = 'pactjoy.habits'::regclass",
      );

      const byName = Object.fromEntries(columns.map((c) => [c.column_name, c]));
      expect(byName.version).toMatchObject({ data_type: "integer", is_nullable: "NO" });
      expect(byName.owner_id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
      expect(byName.id).toMatchObject({ data_type: "uuid" });
      expect(fks).toEqual({ n: 0 });
      expect(rls).toEqual({ on: true });
    } finally {
      await sql.end();
    }
  });
});
