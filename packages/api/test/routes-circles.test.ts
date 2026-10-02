import { ConcurrencyConflict, instant, userId } from "@pactjoy/app";
import { createTestApp } from "@pactjoy/app/testing";
import { describe, expect, it, vi } from "vitest";
import { type ApiDeps, createApi } from "../src/routes/index.ts";
import {
  createCircleBody,
  createDeterministicUuidGenerator,
  createFakeTokenVerifier,
} from "../src/testing/index.ts";

const ANDREA = userId("aaaaaaaa-0000-4000-8000-000000000001");
const VICTOR = userId("aaaaaaaa-0000-4000-8000-000000000002");
const UNKNOWN_CIRCLE = "bbbbbbbb-0000-4000-8000-000000000000";
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

function setup(overrides: Partial<ApiDeps> = {}, allowedOrigins: string[] = []) {
  const app = createTestApp();
  const transaction = vi.fn(app.uow.transaction.bind(app.uow));
  const read = vi.fn(app.uow.read.bind(app.uow));
  const handler = createApi(
    {
      uow: { transaction, read } as typeof app.uow,
      clock: app.clock,
      timeZone: app.timeZone,
      ids: createDeterministicUuidGenerator(),
      random: app.random,
      tokenVerifier: createFakeTokenVerifier({ andrea: ANDREA, victor: VICTOR }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      ...overrides,
    },
    { basePath: "/api", allowedOrigins },
  );
  const call = async (
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
    origin?: string,
  ) => {
    const response = await handler(
      new Request(`http://x/api${path}`, {
        method,
        headers: {
          ...(origin ? { origin } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return {
      status: response.status,
      headers: response.headers,
      // biome-ignore lint/suspicious/noExplicitAny: test helper over an untyped JSON envelope
      json: (await response.json()) as any,
    };
  };
  return { app, call, transaction, read };
}

describe("POST /circles (UE-C-S1..S3)", () => {
  it("S1: 201 with the caller as sole active member, actor from the token only (R0b)", async () => {
    const { app, call } = setup();
    const { status, json } = await call("POST", "/circles", "andrea", createCircleBody("  Crew "));
    expect(status).toBe(201);
    expect(json.data.name).toBe("Crew"); // the app trims; the boundary does not judge text (RV-S27)
    expect(json.data.members).toHaveLength(1);
    expect(json.data.members[0]).toMatchObject({ status: "active", isYou: true });
    expect(JSON.stringify(json)).not.toContain(ANDREA);
    expect(await app.circles.findActiveByUser(ANDREA)).not.toBeNull();
  });

  it("S2: 409 AlreadyInActiveCircle on the second create", async () => {
    const { call } = setup();
    await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    const { status, json } = await call("POST", "/circles", "andrea", createCircleBody("Other"));
    expect([status, json.error.code]).toEqual([409, "AlreadyInActiveCircle"]);
  });

  it("S3 / RV-S27: a blank name reaches the app and comes back InvalidName 422", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("POST", "/circles", "andrea", createCircleBody("   "));
    expect([status, json.error.code]).toEqual([422, "InvalidName"]);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("UE-C-S11: stores the creator's display name, trimmed", async () => {
    const { app, call } = setup();
    const { status } = await call("POST", "/circles", "andrea", {
      name: "Crew",
      displayName: "  Ana ",
    });
    expect(status).toBe(201);
    const stored = await app.circles.findActiveByUser(ANDREA);
    expect(stored?.members[0]?.displayName).toBe("Ana");
  });

  it.each([
    ["blank", "   "],
    ["31 code points", "a".repeat(31)],
  ])(
    "UE-C-S13: a %s display name reaches the app and comes back InvalidDisplayName 422",
    async (_label, displayName) => {
      const { call, transaction } = setup();
      const { status, json } = await call("POST", "/circles", "andrea", {
        name: "Crew",
        displayName,
      });
      expect([status, json.error.code]).toEqual([422, "InvalidDisplayName"]);
      expect(transaction).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["not a string", { name: "Crew", displayName: 5 }, "type"],
    ["missing", { name: "Crew" }, "required"],
  ])(
    "UE-C-S14 / RV-R11: displayName %s is InvalidRequest, no repository call",
    async (_label, body, problem) => {
      const { call, transaction, read } = setup();
      const { status, json } = await call("POST", "/circles", "andrea", body);
      expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
      expect(json.error.details.issues).toContainEqual({ path: "displayName", problem });
      expect(transaction).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["wrong type", { name: 123 }, "type"],
    ["missing field", {}, "required"],
    [
      "unknown field (userId is never accepted: R0b)",
      { name: "x", displayName: "Ana", userId: VICTOR },
      "unknownField",
    ],
    ["no body", undefined, "required"],
  ])("422 InvalidRequest on %s, no repository call (R0c)", async (_label, body, problem) => {
    const { call, transaction, read } = setup();
    const { status, json } = await call("POST", "/circles", "andrea", body);
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues[0].problem).toBe(problem);
    expect(transaction).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("PATCH /circles/:circleId (UE-C-S4)", () => {
  it("renames as a member; 403 for a non-member; 404 for an unknown circle", async () => {
    const { call } = setup();
    const created = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    const path = `/circles/${created.json.data.id}`;
    const renamed = await call("PATCH", path, "andrea", { name: "Team" });
    expect([renamed.status, renamed.json.data.name]).toEqual([200, "Team"]);
    expect(renamed.json.data.version).toBe(created.json.data.version + 1);
    const outsider = await call("PATCH", path, "victor", { name: "Mine" });
    expect([outsider.status, outsider.json.error.code]).toEqual([403, "NotAMember"]);
    const missing = await call("PATCH", `/circles/${UNKNOWN_CIRCLE}`, "andrea", { name: "x" });
    expect([missing.status, missing.json.error.code]).toEqual([404, "CircleNotFound"]);
  });

  it("422 on a malformed circleId or a body that owns the path id, without touching the repositories", async () => {
    const { call, transaction } = setup();
    const badId = await call("PATCH", "/circles/not-a-uuid", "andrea", { name: "x" });
    expect([badId.status, badId.json.error.details.issues[0].path]).toEqual([422, "circleId"]);
    const ownedId = await call("PATCH", `/circles/${UNKNOWN_CIRCLE}`, "andrea", {
      name: "x",
      circleId: UNKNOWN_CIRCLE,
    });
    expect(ownedId.json.error.details.issues[0]).toEqual({
      path: "circleId",
      problem: "unknownField",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("POST /circles/:circleId/invite (UE-C-S5)", () => {
  it("201 with a safe-alphabet code; again gives a different one; body optional", async () => {
    const { call } = setup();
    const { json } = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    const path = `/circles/${json.data.id}/invite`;
    const first = await call("POST", path, "andrea");
    expect(first.status).toBe(201);
    expect(first.json.data.code).toMatch(CODE);
    expect(Object.keys(first.json.data).sort()).toEqual(["code", "createdAt", "expiresAt"]);
    expect(first.json.data).not.toHaveProperty("createdBy");
    const second = await call("POST", path, "andrea", {});
    expect([second.status, second.json.data.code === first.json.data.code]).toEqual([201, false]);
  });

  it("RV-S10: any body field is UnknownField 422; non-member 403; unknown circle 404", async () => {
    const { call } = setup();
    const { json } = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    const path = `/circles/${json.data.id}/invite`;
    const extra = await call("POST", path, "andrea", { circleId: json.data.id });
    expect([extra.status, extra.json.error.details.issues[0].problem]).toEqual([
      422,
      "unknownField",
    ]);
    expect((await call("POST", path, "victor")).json.error.code).toBe("NotAMember");
    const missing = await call("POST", `/circles/${UNKNOWN_CIRCLE}/invite`, "andrea");
    expect([missing.status, missing.json.error.code]).toEqual([404, "CircleNotFound"]);
  });
});

describe("authentication on every route", () => {
  it.each([
    ["POST", "/circles", { name: "x" }],
    ["PATCH", `/circles/${UNKNOWN_CIRCLE}`, { name: "x" }],
    ["POST", `/circles/${UNKNOWN_CIRCLE}/invite`, undefined],
  ])("401 without a token: %s %s", async (method, path, body) => {
    const { call, transaction } = setup();
    const { status, json } = await call(method, path, null, body);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("archived circles (UE-C-S4)", () => {
  async function archived() {
    const ctx = setup();
    const created = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
    const circle = await ctx.app.circles.get(created.json.data.id);
    if (!circle) throw new Error("seed failed");
    await ctx.app.circles.save(
      { ...circle, archivedAt: instant(1), version: circle.version + 1 },
      circle.version,
    );
    return { ...ctx, path: `/circles/${circle.id}` };
  }

  it("rename and generate-invite answer 409 CircleArchived", async () => {
    const { call, path } = await archived();
    const rename = await call("PATCH", path, "andrea", { name: "Back" });
    expect([rename.status, rename.json.error.code]).toEqual([409, "CircleArchived"]);
    const invite = await call("POST", `${path}/invite`, "andrea");
    expect([invite.status, invite.json.error.code]).toEqual([409, "CircleArchived"]);
  });
});

describe("createApi wiring", () => {
  const conflicting = {
    transaction: () => Promise.reject(new ConcurrencyConflict()),
    read: () => Promise.reject(new ConcurrencyConflict()),
  } as unknown as ApiDeps["uow"];

  it("maps a thrown ConcurrencyConflict to 409", async () => {
    const { call } = setup({ uow: conflicting });
    const { status, json } = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    expect([status, json.error.code]).toEqual([409, "ConcurrencyConflict"]);
  });

  it("maps a throw matched by isUnavailable to 503 with Retry-After", async () => {
    const boom = new Error("db down");
    const { call } = setup({
      uow: { transaction: () => Promise.reject(boom), read: () => Promise.reject(boom) } as never,
      isUnavailable: (e) => e === boom,
    });
    const { status, headers, json } = await call(
      "POST",
      "/circles",
      "andrea",
      createCircleBody("Crew"),
    );
    expect([status, json.error.code, headers.get("retry-after")]).toEqual([
      503,
      "ServiceUnavailable",
      "5",
    ]);
  });

  it("emits CORS headers for an allowed origin only", async () => {
    const { call } = setup({}, ["https://app.example"]);
    const ok = await call(
      "POST",
      "/circles",
      "andrea",
      createCircleBody("A"),
      "https://app.example",
    );
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example");
    const bad = await call(
      "POST",
      "/circles",
      "victor",
      createCircleBody("B"),
      "https://evil.example",
    );
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});
