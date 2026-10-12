import { QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import { describe, expect, it } from "vitest";
import { todayKey } from "../shared/query-keys.ts";
import {
  activeTodayFixture,
  endedTodayFixture,
  pactOpenTodayFixture,
} from "../testing/fixtures/today.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import { seedPersistedToday } from "../testing/seed-persisted-today.ts";
import {
  bustFor,
  CACHE_VERSION,
  createTodayPersister,
  MAX_AGE_MS,
  persistOptionsFor,
  STORAGE_KEY,
} from "./query-persister.ts";

const TODAY = { state: "noCircle" } as const;

async function save(storage: Storage, fill: (client: QueryClient) => void) {
  const persister = createTodayPersister(storage, { throttleMs: 0 });
  const client = new QueryClient();
  fill(client);
  const options = persistOptionsFor(persister, bustFor("user-1"));
  await persistQueryClientSave({ queryClient: client, ...options });
  // The sync persister writes on a timer even with no throttle: let it run.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return persister;
}

describe("a saved Today from before the shape changed is dropped, not rendered", () => {
  const RESTORED_WITHOUT_POINTS = {
    state: "active",
    summary: { week: 1, weekCount: 4, daysLeft: 2, score: { kind: "scored" } },
    rows: [{ kind: "day", habitName: "Meditar", entries: [] }],
  };

  async function restoreFrom(saved: unknown) {
    const storage = new MemoryStorage();
    await save(storage, (client) => client.setQueryData(todayKey, saved));
    const reloaded = new QueryClient();
    await persistQueryClientRestore({
      queryClient: reloaded,
      ...persistOptionsFor(createTodayPersister(storage, { throttleMs: 0 }), bustFor("user-1")),
    });
    return { reloaded, storage };
  }

  it("drops a Today whose rows carry no points, and clears the saved copy", async () => {
    const { reloaded, storage } = await restoreFrom(RESTORED_WITHOUT_POINTS);
    expect(reloaded.getQueryData(todayKey)).toBeUndefined();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("drops a Today whose summary has no pointsToday", async () => {
    const { reloaded } = await restoreFrom({
      ...RESTORED_WITHOUT_POINTS,
      rows: [],
    });
    expect(reloaded.getQueryData(todayKey)).toBeUndefined();
  });

  it("drops a Today whose points lack the exact per-opportunity value (version 3 saved copies)", async () => {
    const view = activeTodayFixture();
    // A version 3 row: everything a row carries, but no exact per-opportunity value.
    const pointsV3 = { perOpportunity: "8", earned: null, limitPercents: null };
    const { reloaded } = await restoreFrom({
      ...view,
      rows: view.rows.map((row) => ({ ...row, points: pointsV3 })),
    });
    expect(reloaded.getQueryData(todayKey)).toBeUndefined();
  });

  it("drops a Today whose rows lack the nested `pause` (version 5 saved copies, PS-16)", async () => {
    const view = activeTodayFixture();
    const { reloaded } = await restoreFrom({
      ...view,
      rows: view.rows.map(({ pause: _pause, ...row }) => row),
    });
    expect(reloaded.getQueryData(todayKey)).toBeUndefined();
  });

  it.each([
    ["active", () => activeTodayFixture()],
    ["pactOpen", () => ({ ...pactOpenTodayFixture(), myCommitments: [] })],
    [
      "notStarted",
      () => ({ ...pactOpenTodayFixture(), state: "notStarted" as const, myCommitments: [] }),
    ],
  ])(
    "drops a %s Today saved before the periodic review (version 6: no pendingReview or baselineOffer)",
    async (_state, make) => {
      for (const missing of ["pendingReview", "baselineOffer"] as const) {
        const { [missing]: _removed, ...old } = make() as Record<string, unknown>;
        const { reloaded } = await restoreFrom(old);
        expect(reloaded.getQueryData(todayKey), `without ${missing}`).toBeUndefined();
      }
    },
  );

  it.each([
    ["active", () => activeTodayFixture()],
    ["ended", () => endedTodayFixture()],
  ])(
    "drops a %s Today saved before the season closure (version 7: no seasonClose)",
    async (_state, make) => {
      const { seasonClose: _removed, ...old } = make();
      const { reloaded } = await restoreFrom(old);
      expect(reloaded.getQueryData(todayKey)).toBeUndefined();
    },
  );

  it("purges version 7: the season closure arrived with version 8", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, activeTodayFixture());
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    saved.buster = "7:user-1";
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const reloaded = new QueryClient();
    await persistQueryClientRestore({
      queryClient: reloaded,
      ...persistOptionsFor(createTodayPersister(storage), bustFor("user-1")),
    });
    expect(reloaded.getQueryData(todayKey)).toBeUndefined();
    expect(Number(CACHE_VERSION)).toBeGreaterThan(7);
  });

  it("purges version 6 even with an otherwise valid shape: the review fields arrived with version 7", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, activeTodayFixture());
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    saved.buster = "6:user-1";
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const reloaded = new QueryClient();
    await persistQueryClientRestore({
      queryClient: reloaded,
      ...persistOptionsFor(createTodayPersister(storage), bustFor("user-1")),
    });
    expect(reloaded.getQueryData(todayKey)).toBeUndefined();
    expect(Number(CACHE_VERSION)).toBeGreaterThan(6);
  });

  it("keeps a current Today", async () => {
    const current = activeTodayFixture();
    const { reloaded } = await restoreFrom(current);
    expect(reloaded.getQueryData(todayKey)).toEqual(current);
  });

  it("keeps a Today with no rows to check, like noCircle", async () => {
    const { reloaded } = await restoreFrom(TODAY);
    expect(reloaded.getQueryData(todayKey)).toEqual(TODAY);
  });
});

describe("createTodayPersister (TO-R10)", () => {
  it.each(["pactOpen", "notStarted"])("retains current %s owned commitments", async (state) => {
    const storage = new MemoryStorage();
    const current = {
      ...pactOpenTodayFixture(),
      state,
      myCommitments: [
        { id: "c-1", habitName: "Leer", icon: "book", weightPercent: 100, maxPoints: 1000 },
      ],
    };
    const persister = await save(storage, (client) => client.setQueryData(todayKey, current));
    const restored = new QueryClient();
    await persistQueryClientRestore({
      queryClient: restored,
      ...persistOptionsFor(persister, bustFor("user-1")),
    });
    expect(restored.getQueryData(todayKey)).toEqual(current);
  });
  it("purges version 4 even with an unchanged valid shape: ended scores and weekly series changed", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, activeTodayFixture());
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    saved.buster = "4:user-1";
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const reloaded = new QueryClient();
    await persistQueryClientRestore({
      queryClient: reloaded,
      ...persistOptionsFor(createTodayPersister(storage), bustFor("user-1")),
    });
    expect(reloaded.getQueryData(todayKey)).toBeUndefined();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("purges every earlier cache version, so a Today saved before the nested `pause` is never restored (PS-16)", async () => {
    for (let version = 1; version < Number(CACHE_VERSION); version += 1) {
      const storage = new MemoryStorage();
      seedPersistedToday(storage, activeTodayFixture());
      const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
      saved.buster = `${version}:user-1`;
      storage.setItem(STORAGE_KEY, JSON.stringify(saved));
      const reloaded = new QueryClient();
      await persistQueryClientRestore({
        queryClient: reloaded,
        ...persistOptionsFor(createTodayPersister(storage), bustFor("user-1")),
      });
      expect(reloaded.getQueryData(todayKey), `version ${version}`).toBeUndefined();
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
    }
  });

  it("purges an unknown saved state instead of treating it as a safe rowless view", async () => {
    const storage = new MemoryStorage();
    const persister = await save(storage, (client) =>
      client.setQueryData(todayKey, { state: "unrecognized" }),
    );
    expect(await persister.restoreClient()).toBeUndefined();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
  it("purges a pre-season payload without its current myCommitments array", async () => {
    const storage = new MemoryStorage();
    const { myCommitments: _, ...old } = pactOpenTodayFixture();
    const persister = await save(storage, (client) =>
      client.setQueryData(todayKey, { ...old, state: "notStarted" }),
    );
    expect(await persister.restoreClient()).toBeUndefined();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
  it("restores the last Today after a reload", async () => {
    const storage = new MemoryStorage();
    await save(storage, (client) => client.setQueryData(todayKey, TODAY));
    const reloaded = new QueryClient();
    await persistQueryClientRestore({
      queryClient: reloaded,
      ...persistOptionsFor(createTodayPersister(storage, { throttleMs: 0 }), bustFor("user-1")),
    });
    expect(reloaded.getQueryData(todayKey)).toEqual(TODAY);
  });

  it("does not restore the saved Today for a different user (C-W5)", async () => {
    const storage = new MemoryStorage();
    await save(storage, (client) => client.setQueryData(todayKey, TODAY));
    const other = new QueryClient();
    await persistQueryClientRestore({
      queryClient: other,
      ...persistOptionsFor(createTodayPersister(storage, { throttleMs: 0 }), bustFor("user-2")),
    });
    expect(other.getQueryData(todayKey)).toBeUndefined();
  });

  it("tells users and cache versions apart, and a signed-out visitor from any user", () => {
    expect(bustFor("user-1")).not.toBe(bustFor("user-2"));
    expect(bustFor(null)).not.toBe(bustFor("user-1"));
    expect(bustFor("user-1")).toContain(CACHE_VERSION);
  });

  it("persists only Today, never another query", async () => {
    const storage = new MemoryStorage();
    await save(storage, (client) => {
      client.setQueryData(todayKey, TODAY);
      client.setQueryData(["circle", "members"], { secret: "other" });
      client.setQueryData(["progress", "season", "season-1"], { secret: "series" });
      client.setQueryData(["progress", "commitment", "season-1", "commitment-1"], {
        secret: "history",
      });
    });
    const saved = storage.getItem(STORAGE_KEY) ?? "";
    expect(saved).toContain("noCircle");
    expect(saved).not.toContain("secret");
  });

  it("does not persist a Today that failed to load", async () => {
    const storage = new MemoryStorage();
    await save(storage, (client) => {
      void client.prefetchQuery({
        queryKey: todayKey,
        queryFn: () => Promise.reject(new Error("x")),
        retry: false,
      });
    });
    expect(storage.getItem(STORAGE_KEY) ?? "").not.toContain("noCircle");
  });

  it("never persists a mutation, so no write can be replayed after a reload (P1)", () => {
    const options = persistOptionsFor(createTodayPersister(new MemoryStorage()), bustFor("user-1"));
    expect(options.dehydrateOptions?.shouldDehydrateMutation?.({} as never)).toBe(false);
  });

  it("keeps it for 24 hours", () => {
    expect(MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(
      persistOptionsFor(createTodayPersister(new MemoryStorage()), bustFor("user-1")).maxAge,
    ).toBe(MAX_AGE_MS);
  });

  it("removeClient forgets the cached Today (sign out)", async () => {
    const storage = new MemoryStorage();
    const persister = await save(storage, (client) => client.setQueryData(todayKey, TODAY));
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    await persister.removeClient();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps working when storage is blocked or refuses writes", async () => {
    const blocked: Storage = Object.assign(new MemoryStorage(), {
      setItem() {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    await expect(
      save(blocked, (client) => client.setQueryData(todayKey, TODAY)),
    ).resolves.toBeDefined();
    const none = createTodayPersister(null);
    await expect(
      none.persistClient({ timestamp: 1, buster: "", clientState: { mutations: [], queries: [] } }),
    ).resolves.toBeUndefined();
    await expect(none.restoreClient()).resolves.toBeUndefined();
  });
});
