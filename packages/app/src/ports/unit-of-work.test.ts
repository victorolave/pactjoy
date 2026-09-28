import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { err, ok } from "../shared/result.ts";
import { createInMemoryUnitOfWork } from "../testing/in-memory-unit-of-work.ts";

interface CounterRepo {
  value: number;
  increment(): void;
}

function createCounterRepo(initial: number): CounterRepo {
  return {
    value: initial,
    increment() {
      this.value += 1;
    },
  };
}

/**
 * A toy per-transaction scope (ADR-0008, D4/D5): each `beginTransaction()`
 * call hands `work()` its own staged `CounterRepo`, starting from the live
 * value; `commit()` applies the staged value to the live repo, unless
 * `forceCommitError` is set (simulating a real repository's `commit()`
 * throwing `ConcurrencyConflict` because a touched aggregate's version
 * moved on). Same shape `createInMemoryCircleRepository().beginTransaction()`
 * uses, minus real aggregate versioning (a plain counter has none).
 */
function createFixture() {
  const live = createCounterRepo(0);
  let commitCalls = 0;
  let forceCommitError: Error | null = null;

  function beginTransaction() {
    const staged = createCounterRepo(live.value);
    return {
      repositories: staged,
      commit(): void {
        commitCalls += 1;
        if (forceCommitError) {
          throw forceCommitError;
        }
        live.value = staged.value;
      },
    };
  }

  const uow = createInMemoryUnitOfWork({ repositories: live, beginTransaction });
  return {
    live,
    uow,
    commitCalls: () => commitCalls,
    setForceCommitError: (error: Error | null) => {
      forceCommitError = error;
    },
  };
}

describe("createInMemoryUnitOfWork", () => {
  it("commits the work's staged side effects when the work returns ok", async () => {
    const { live, uow } = createFixture();

    const result = await uow.transaction(async (repos) => {
      repos.increment();
      repos.increment();
      return ok(repos.value);
    });

    expect(result).toEqual({ ok: true, value: 2 });
    expect(live.value).toBe(2);
  });

  it("never commits (staged changes never reach the live repositories) when the work returns err", async () => {
    const { live, uow, commitCalls } = createFixture();

    const result = await uow.transaction(async (repos) => {
      repos.increment();
      return err({ kind: "Rejected" as const });
    });

    expect(result).toEqual({ ok: false, error: { kind: "Rejected" } });
    expect(live.value).toBe(0);
    expect(commitCalls()).toBe(0);
  });

  it("never commits when the work throws", async () => {
    const { live, uow, commitCalls } = createFixture();

    await expect(
      uow.transaction(async (repos) => {
        repos.increment();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(live.value).toBe(0);
    expect(commitCalls()).toBe(0);
  });

  it("read() exposes the current repositories without any transaction machinery", async () => {
    const { live, uow } = createFixture();
    live.increment();

    const value = await uow.read(async (repos) => repos.value);

    expect(value).toBe(1);
  });

  it("D5: when commit() throws (e.g. ConcurrencyConflict from a real repository), the error propagates and nothing is applied to the live repositories", async () => {
    const { live, uow, setForceCommitError } = createFixture();
    setForceCommitError(new ConcurrencyConflict());

    await expect(
      uow.transaction(async (repos) => {
        repos.increment();
        return ok(repos.value);
      }),
    ).rejects.toThrow(ConcurrencyConflict);
    expect(live.value).toBe(0);
  });
});
