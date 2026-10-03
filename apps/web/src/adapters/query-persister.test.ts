import { QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import { describe, expect, it } from "vitest";
import { todayKey } from "../shared/query-keys.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import {
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
  const options = persistOptionsFor(persister);
  await persistQueryClientSave({ queryClient: client, ...options });
  // The sync persister writes on a timer even with no throttle: let it run.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return persister;
}

describe("createTodayPersister (TO-R10)", () => {
  it("restores the last Today after a reload", async () => {
    const storage = new MemoryStorage();
    await save(storage, (client) => client.setQueryData(todayKey, TODAY));
    const reloaded = new QueryClient();
    await persistQueryClientRestore({
      queryClient: reloaded,
      ...persistOptionsFor(createTodayPersister(storage, { throttleMs: 0 })),
    });
    expect(reloaded.getQueryData(todayKey)).toEqual(TODAY);
  });

  it("persists only Today, never another query", async () => {
    const storage = new MemoryStorage();
    await save(storage, (client) => {
      client.setQueryData(todayKey, TODAY);
      client.setQueryData(["circle", "members"], { secret: "other" });
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
    const options = persistOptionsFor(createTodayPersister(new MemoryStorage()));
    expect(options.dehydrateOptions?.shouldDehydrateMutation?.({} as never)).toBe(false);
  });

  it("keeps it for 24 hours", () => {
    expect(MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(persistOptionsFor(createTodayPersister(new MemoryStorage())).maxAge).toBe(MAX_AGE_MS);
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
