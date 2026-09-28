import { describe, expect, it } from "vitest";
import { err, ok } from "../shared/result.ts";
import { createInMemoryUnitOfWork } from "../testing/in-memory-unit-of-work.ts";

interface CounterRepo {
  value: number;
  increment(): void;
}

function createFixture() {
  const repositories: CounterRepo = {
    value: 0,
    increment() {
      this.value += 1;
    },
  };
  const uow = createInMemoryUnitOfWork({
    repositories,
    snapshot: () => ({ value: repositories.value }),
    restore: (snapshot) => {
      repositories.value = snapshot.value;
    },
  });
  return { repositories, uow };
}

describe("createInMemoryUnitOfWork", () => {
  it("commits the work's side effects when the work returns ok", async () => {
    const { repositories, uow } = createFixture();

    const result = await uow.transaction(async (repos) => {
      repos.increment();
      repos.increment();
      return ok(repos.value);
    });

    expect(result).toEqual({ ok: true, value: 2 });
    expect(repositories.value).toBe(2);
  });

  it("rolls back the work's side effects when the work returns err", async () => {
    const { repositories, uow } = createFixture();

    const result = await uow.transaction(async (repos) => {
      repos.increment();
      return err({ kind: "Rejected" as const });
    });

    expect(result).toEqual({ ok: false, error: { kind: "Rejected" } });
    expect(repositories.value).toBe(0);
  });

  it("rolls back the work's side effects when the work throws", async () => {
    const { repositories, uow } = createFixture();

    await expect(
      uow.transaction(async (repos) => {
        repos.increment();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(repositories.value).toBe(0);
  });

  it("read() exposes the current repositories without any rollback machinery", async () => {
    const { repositories, uow } = createFixture();
    repositories.increment();

    const value = await uow.read(async (repos) => repos.value);

    expect(value).toBe(1);
  });
});
