import { describe, expect, it, vi } from "vitest";
import { WebLocks } from "./web-locks.ts";

describe("WebLocks", () => {
  it("runs the work inside navigator.locks under the given name", async () => {
    const request = vi.fn((_name: string, work: () => Promise<unknown>) => work());
    const locks = new WebLocks({ request } as unknown as LockManager);
    await expect(locks.run("pactjoy.outbox:user-1", async () => 42)).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith("pactjoy.outbox:user-1", expect.any(Function));
  });

  it("just runs the work where the platform has no Web Locks", async () => {
    const locks = new WebLocks(undefined);
    await expect(locks.run("pactjoy.outbox:user-1", async () => "ran")).resolves.toBe("ran");
  });

  it("passes a failure of the work through", async () => {
    const request = (_name: string, work: () => Promise<unknown>) => work();
    const locks = new WebLocks({ request } as unknown as LockManager);
    await expect(
      locks.run("x", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
