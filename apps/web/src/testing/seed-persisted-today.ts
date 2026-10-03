import type { TodayView } from "@pactjoy/app";
import { dehydrate, QueryClient } from "@tanstack/react-query";
import { bustFor, STORAGE_KEY } from "../adapters/query-persister.ts";
import { todayKey } from "../shared/query-keys.ts";

/**
 * Writes what a previous visit would have left behind: a persisted Today, `ageMs` old. Built with
 * the library's own `dehydrate`, so the stored format is never hand-rolled.
 */
export function seedPersistedToday(
  storage: Storage,
  today: TodayView,
  ageMs = 5 * 60 * 1000,
  userId: string | null = "user-1",
): void {
  const client = new QueryClient();
  client.setQueryData(todayKey, today, { updatedAt: Date.now() - ageMs });
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      buster: bustFor(userId),
      timestamp: Date.now() - ageMs,
      clientState: dehydrate(client),
    }),
  );
}
