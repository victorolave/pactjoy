import { describe, expect, it } from "vitest";
import { bootstrapRoles } from "./bootstrap-roles.ts";
import type { Sql } from "./db.ts";

/** Stub: no role exists yet, and `create role` fails with the given SQLSTATE. */
function sqlFailingWith(code: string): Sql {
  const tag = async () => [];
  return Object.assign(tag, {
    unsafe: async () => {
      throw Object.assign(new Error("create role failed"), { code });
    },
  }) as unknown as Sql;
}

describe("bootstrapRoles", () => {
  it("tolerates a concurrent run that created the role first (42710)", async () => {
    await expect(bootstrapRoles(sqlFailingWith("42710"))).resolves.toBeUndefined();
  });

  it("rethrows every other failure", async () => {
    await expect(bootstrapRoles(sqlFailingWith("42501"))).rejects.toThrow("create role failed");
  });
});
