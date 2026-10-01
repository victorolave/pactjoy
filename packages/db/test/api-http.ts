import { createApi } from "@pactjoy/api";
import { createFakeTokenVerifier } from "@pactjoy/api/testing";
import {
  createCryptoRandomSource,
  createIntlTimeZone,
  createUuidV7IdGenerator,
  instant,
  userId,
} from "@pactjoy/app";
import { createPostgresUnitOfWork } from "../src/index.ts";
import { databaseUrl } from "./db.ts";

export const NOW = instant(1_759_060_800_000); // 2025-09-28T12:00:00Z
export const TODAY = "2025-09-28";
export const USERS = Array.from({ length: 8 }, (_, i) =>
  userId(`aaaaaaaa-0000-4000-8000-00000000000${i + 1}`),
);
/** Token `u1`..`u8` authenticates as the matching user. */
export const tokens = Object.fromEntries(USERS.map((u, i) => [`u${i + 1}`, u]));

/** A measure that scores every day of the week, so an entry made today counts at once. */
export const DAILY = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};

/** The real handler (fake token verifier) over the migrated Postgres, with a pool of `max`. */
export function createHttpOverPostgres(max = 3) {
  const clock = { now: () => NOW };
  const uow = createPostgresUnitOfWork({ url: databaseUrl(), max });
  const handler = createApi(
    {
      uow,
      clock,
      timeZone: createIntlTimeZone(),
      ids: createUuidV7IdGenerator({ clock }),
      random: createCryptoRandomSource(),
      tokenVerifier: createFakeTokenVerifier(tokens),
      logger: { warn: () => undefined, error: () => undefined },
    },
    { basePath: "/api", allowedOrigins: [] },
  );
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const response = await handler(
      new Request(`http://x/api${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test helper over an untyped JSON envelope
    return { status: response.status, json: (await response.json()) as any };
  };
  return { call, end: () => uow.end() };
}
