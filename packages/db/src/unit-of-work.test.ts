import { ConcurrencyConflict, err, ok } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import type { Client, Isolation, SqlExecutor } from "./client.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const pgError = (code: string, constraint_name?: string) =>
  Object.assign(new Error(`pg ${code}`), { code, constraint_name });

/** A `begin` that, like the driver, runs `work` and propagates whatever it throws. */
function setup() {
  const isolations: Isolation[] = [];
  const tx: SqlExecutor = { query: async () => ({ rows: [], rowCount: 0 }) };
  const begin: Client["begin"] = async (isolation, work) => {
    isolations.push(isolation);
    return work(tx);
  };
  return { isolations, uow: createUnitOfWork(begin, () => ({})) };
}

describe("retry loop", () => {
  it("UW-S22: 40001 once then ok runs work twice and returns ok", async () => {
    const { uow } = setup();
    let runs = 0;

    const result = await uow.transaction(async () => {
      runs += 1;
      if (runs === 1) throw pgError("40001");
      return ok("done");
    });

    expect(result).toEqual(ok("done"));
    expect(runs).toBe(2);
  });

  it("UW-S23: 40P01 every time runs work exactly twice, then ConcurrencyConflict", async () => {
    const { uow, isolations } = setup();
    let runs = 0;

    const error = await uow
      .transaction(async () => {
        runs += 1;
        throw pgError("40P01");
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConcurrencyConflict);
    expect(runs).toBe(2);
    expect(isolations).toEqual(Array(2).fill("isolation level read committed"));
  });

  it("UW-S24: 23505 on a named constraint is not retried", async () => {
    const { uow } = setup();
    let runs = 0;

    const error = await uow
      .transaction(async () => {
        runs += 1;
        throw pgError("23505", "habits_pkey");
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConcurrencyConflict);
    expect(runs).toBe(1);
  });

  it("a version-mismatch ConcurrencyConflict thrown by work is never retried", async () => {
    const { uow } = setup();
    let runs = 0;
    const conflict = new ConcurrencyConflict();

    const error = await uow
      .transaction(async () => {
        runs += 1;
        throw conflict;
      })
      .catch((e) => e);

    expect(error).toBe(conflict);
    expect(runs).toBe(1);
  });

  it("an unrelated error is rethrown unchanged and not retried", async () => {
    const { uow } = setup();
    let runs = 0;
    const boom = pgError("23503");

    const error = await uow
      .transaction(async () => {
        runs += 1;
        throw boom;
      })
      .catch((e) => e);

    expect(error).toBe(boom);
    expect(runs).toBe(1);
  });

  it("UW-S25: an err Result is returned without retry", async () => {
    const { uow } = setup();
    let runs = 0;

    const result = await uow.transaction(async () => {
      runs += 1;
      return err("nope");
    });

    expect(result).toEqual(err("nope"));
    expect(runs).toBe(1);
  });
});

describe("read", () => {
  it("opens a repeatable read read only transaction", async () => {
    const { uow, isolations } = setup();

    await expect(uow.read(async () => 7)).resolves.toBe(7);

    expect(isolations).toEqual(["isolation level repeatable read read only"]);
  });

  it("maps a serialization failure to ConcurrencyConflict, without retry", async () => {
    const { uow } = setup();
    let runs = 0;

    const error = await uow
      .read(async () => {
        runs += 1;
        throw pgError("40001");
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConcurrencyConflict);
    expect(runs).toBe(1);
  });

  it("rethrows a read-only violation (25006) unchanged", async () => {
    const { uow } = setup();
    const readOnly = pgError("25006");

    const error = await uow
      .read(async () => {
        throw readOnly;
      })
      .catch((e) => e);

    expect(error).toBe(readOnly);
  });
});
