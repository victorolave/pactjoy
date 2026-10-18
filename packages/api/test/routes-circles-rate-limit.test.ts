import { instant } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createNetworkKeyer } from "../src/http/network-key.ts";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { setup, VICTOR } from "./harness.ts";

/**
 * Rate limiting in front of `POST /circles/join/preview` and `POST /circles/join` (ADR-0011 Q17,
 * ADR-0020, REQ-RL1..RL7): both share one budget per user (10 a minute, 30 an hour) and per client
 * network; every attempt counts before anything else is looked at, and a refusal is the same 429
 * whether the code exists or not.
 */

// 10:00:15Z on 2026-10-20: 45 seconds left in the minute.
const MINUTE_START = 1_792_490_400_000;
const RATE_LIMIT_KEY = "r".repeat(32);

async function given(options: { readonly rateLimitKey?: string | null } = {}) {
  const ctx = setup(options);
  ctx.setNow(instant(MINUTE_START + 15_000));
  const created = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew", "Zoe"));
  const invite = await ctx.call("POST", `/circles/${created.json.data.id}/invite`, "andrea");
  const preview = (code: string, token = "victor") =>
    ctx.call("POST", "/circles/join/preview", token, { inviteCode: code });
  const join = (code: string, token = "victor") =>
    ctx.call("POST", "/circles/join", token, joinCircleBody(code, "Victor"));
  return { ...ctx, code: invite.json.data.code as string, preview, join };
}

const tooMany = {
  status: 429,
  json: { error: { code: "TooManyJoinAttempts", message: "TooManyJoinAttempts" } },
};

describe("join attempts are rate limited (ADR-0020)", () => {
  it("RL1, RL3: the 11th attempt in a minute is a 429 that says nothing about the code", async () => {
    const { preview, code } = await given();
    for (let i = 0; i < 10; i += 1) expect((await preview("AAAAAA")).status).toBe(404);

    const known = await preview(code);
    const unknown = await preview("AAAAAA");
    expect(known).toEqual(tooMany);
    expect(unknown).toEqual(known);
  });

  it("RL1: preview and join share the budget, and failed attempts count", async () => {
    const { preview, join, code } = await given();
    // The lenient preview takes any string, so a junk code is an attempt like any other.
    for (let i = 0; i < 5; i += 1) expect((await preview("x")).status).toBe(404);
    for (let i = 0; i < 5; i += 1) expect((await join("AAAAAA")).status).toBe(404);
    expect(await join(code)).toEqual(tooMany);
  });

  it("RL1: a malformed body is a 422 that is not counted and never touches the store", async () => {
    const { call, preview, code, transaction } = await given();
    transaction.mockClear();
    for (let i = 0; i < 12; i += 1) {
      expect((await call("POST", "/circles/join", "victor", { inviteCode: 7 })).status).toBe(422);
      expect((await call("POST", "/circles/join/preview", "victor", {})).status).toBe(422);
    }
    expect(transaction).not.toHaveBeenCalled();
    expect((await preview(code)).status).toBe(200);
  });

  it("RL3: the 429 carries Retry-After in whole seconds until the window ends", async () => {
    const { handler, preview } = await given();
    for (let i = 0; i < 10; i += 1) await preview("AAAAAA");
    const response = await handler(
      new Request("http://x/api/circles/join/preview", {
        method: "POST",
        headers: { authorization: "Bearer victor", "content-type": "application/json" },
        body: JSON.stringify({ inviteCode: "AAAAAA" }),
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("45");
  });

  it("RL2: each user has their own budget, and a new minute opens it again", async () => {
    const { preview, setNow, code } = await given();
    for (let i = 0; i < 10; i += 1) await preview("AAAAAA");
    expect((await preview(code)).status).toBe(429);
    expect((await preview(code, "carla")).status).toBe(200);
    setNow(instant(MINUTE_START + 60_000));
    expect((await preview(code)).status).toBe(200);
  });

  it("RL5, RL6: with the key, the network is counted under its keyed hash, never the address", async () => {
    const { handler, app } = await given({ rateLimitKey: RATE_LIMIT_KEY });
    await handler(
      new Request("http://x/api/circles/join/preview", {
        method: "POST",
        headers: {
          authorization: "Bearer victor",
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        },
        body: JSON.stringify({ inviteCode: "AAAAAA" }),
      }),
    );
    const hashed = `network:${await createNetworkKeyer(RATE_LIMIT_KEY)("203.0.113.7")}`;
    const counts = await countsOf(app, [hashed, "network:203.0.113.7"]);
    expect(counts).toEqual([2, 1]);
  });

  it("RL7: without the key, or without the header, only the user is counted", async () => {
    for (const [rateLimitKey, forwarded] of [
      [null, "203.0.113.7"],
      [RATE_LIMIT_KEY, null],
    ] as const) {
      const { handler, app } = await given({ rateLimitKey });
      await handler(
        new Request("http://x/api/circles/join/preview", {
          method: "POST",
          headers: {
            authorization: "Bearer victor",
            "content-type": "application/json",
            ...(forwarded === null ? {} : { "x-forwarded-for": forwarded }),
          },
          body: JSON.stringify({ inviteCode: "AAAAAA" }),
        }),
      );
      const hashed = `network:${await createNetworkKeyer(RATE_LIMIT_KEY)("203.0.113.7")}`;
      // The probe's own hit: 1 means no network counter; 2 means the user was counted.
      expect(await countsOf(app, [hashed, `user:${VICTOR}`])).toEqual([1, 2]);
    }
  });

  it("an attempt without a valid token is a 401 and is not counted", async () => {
    const { call, preview, code } = await given();
    for (let i = 0; i < 20; i += 1) {
      expect((await call("POST", "/circles/join/preview", null, { inviteCode: code })).status).toBe(
        401,
      );
    }
    expect((await preview(code)).status).toBe(200);
  });

  it("the other circle routes are not limited", async () => {
    const { call } = await given();
    for (let i = 0; i < 12; i += 1) {
      expect((await call("POST", "/circles", "carla", createCircleBody("", "C"))).status).toBe(422);
    }
  });
});

/** The count of each network counter in the current minute, after one more hit of the probe. */
async function countsOf(app: ReturnType<typeof setup>["app"], subjects: readonly string[]) {
  const result = await app.uow.transaction(async ({ rateLimits }) => ({
    ok: true as const,
    value: await rateLimits.hit(
      subjects.map((subject) => ({
        action: "joinCircle" as const,
        subject,
        windowStart: instant(MINUTE_START),
        windowSeconds: 60,
      })),
    ),
  }));
  return result.ok ? result.value : [];
}
