import { userId } from "@pactjoy/app";
import { createTestApp } from "@pactjoy/app/testing";
import { vi } from "vitest";
import { createApi } from "../src/routes/index.ts";
import { createDeterministicUuidGenerator, createFakeTokenVerifier } from "../src/testing/index.ts";

export const ANDREA = userId("aaaaaaaa-0000-4000-8000-000000000001");
export const VICTOR = userId("aaaaaaaa-0000-4000-8000-000000000002");
export const UNKNOWN_CIRCLE = "bbbbbbbb-0000-4000-8000-000000000000";

/** `createApi` over the in-memory app with spies on the unit of work (token `andrea` / `victor`). */
export function setup() {
  const app = createTestApp();
  const transaction = vi.fn(app.uow.transaction.bind(app.uow));
  const read = vi.fn(app.uow.read.bind(app.uow));
  let now = app.clock.now();
  const clock = { now: () => now };
  /** Moves the API's clock; the in-memory app keeps its own fixed one. */
  const setNow = (instant: typeof now) => {
    now = instant;
  };
  const handler = createApi(
    {
      uow: { transaction, read } as typeof app.uow,
      clock,
      timeZone: app.timeZone,
      ids: createDeterministicUuidGenerator(),
      random: app.random,
      tokenVerifier: createFakeTokenVerifier({ andrea: ANDREA, victor: VICTOR }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    },
    { basePath: "/api", allowedOrigins: [] },
  );
  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const response = await handler(
      new Request(`http://x/api${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test helper over an untyped JSON envelope
    return { status: response.status, json: (await response.json()) as any };
  };
  /** Sends `text` verbatim as the JSON body (JSON.stringify cannot emit an own `__proto__` key). */
  const callRaw = async (method: string, path: string, token: string, text: string) => {
    const response = await handler(
      new Request(`http://x/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: text,
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test helper over an untyped JSON envelope
    return { status: response.status, json: (await response.json()) as any };
  };
  return { app, call, callRaw, transaction, read, setNow };
}
