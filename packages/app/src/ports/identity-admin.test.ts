import { describe, expect, it } from "vitest";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createInMemoryIdentityAdmin } from "../testing/in-memory-identity-admin.ts";
import { IdentityAdminError } from "./identity-admin.ts";

describe("IdentityAdmin fake", () => {
  it("gives each test app an isolated identity adapter outside its transaction", async () => {
    const first = createTestApp();
    const second = createTestApp();
    const id = userId("user-andrea");
    await first.identity.deleteUser(id);
    expect(first.identity.deleted).toEqual([id]);
    expect(second.identity.deleted).toEqual([]);
  });

  it("hard-deletes idempotently while recording each retry", async () => {
    const identity = createInMemoryIdentityAdmin();
    const id = userId("user-andrea");
    await identity.deleteUser(id);
    await identity.deleteUser(id);
    expect(identity.deleted).toEqual([id, id]);
  });

  it("records no deletion on failure and allows a later retry", async () => {
    const identity = createInMemoryIdentityAdmin();
    const id = userId("user-victor");
    identity.setFailure("unavailable");
    await expect(identity.deleteUser(id)).rejects.toEqual(new IdentityAdminError("unavailable"));
    expect(identity.deleted).toEqual([]);
    identity.setFailure(null);
    await identity.deleteUser(id);
    expect(identity.deleted).toEqual([id]);
  });
});
