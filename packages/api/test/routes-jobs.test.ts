import { createRecordingPushSender } from "@pactjoy/app/testing";
import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "../src/auth/jobs-guard.ts";
import { setup } from "./harness.ts";

/**
 * The job routes (ADR-0017, design J9, REQ-J1..J6): a second pipeline under `/api/jobs`, mounted
 * only when `API_JOBS_SECRET` is set, authenticated by that secret alone, with no CORS, returning
 * counts only.
 */

const SECRET = `${"s".repeat(24)}-job-secret-1234`;

const job = (name: string, authorization: string | null, method = "POST") =>
  callJob(
    setup({ jobsSecret: SECRET, push: createRecordingPushSender() }),
    name,
    authorization,
    method,
  );

async function callJob(
  ctx: ReturnType<typeof setup>,
  name: string,
  authorization: string | null,
  method = "POST",
  headers: Record<string, string> = {},
) {
  const response = await ctx.handler(
    new Request(`http://x/api/jobs/${name}`, {
      method,
      headers: { ...(authorization === null ? {} : { authorization }), ...headers },
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    json: JSON.parse(text || "null"),
  };
}

describe("job routes with the right secret", () => {
  it.each([
    ["settle-due-pauses", { settled: 0 }],
    ["sweep-entry-photos", { released: 0, purged: 0 }],
    ["plan-notifications", { enqueued: 0 }],
    [
      "dispatch-notifications",
      { claimed: 0, sent: 0, dropped: 0, retried: 0, failed: 0, deferred: 0 },
    ],
  ])("SC-J1: POST /jobs/%s runs the job and answers its counts", async (name, counts) => {
    const res = await job(name, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: counts });
  });

  it("only POST is routed", async () => {
    const res = await job("plan-notifications", `Bearer ${SECRET}`, "GET");
    expect(res.status).toBe(405);
  });
});

describe("job route authentication (REQ-J2..J4)", () => {
  it.each([
    ["no Authorization header", null],
    ["a wrong secret", `Bearer ${SECRET}x`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["a user token (SC-J2)", "Bearer andrea"],
    ["the secret without the Bearer scheme", SECRET],
  ])("401 with %s, and nothing runs", async (_name, authorization) => {
    const ctx = setup({ jobsSecret: SECRET, push: createRecordingPushSender() });
    const res = await callJob(ctx, "plan-notifications", authorization);
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("Unauthorized");
    expect(res.text).not.toContain(SECRET);
    expect(ctx.transaction).not.toHaveBeenCalled();
    expect(ctx.read).not.toHaveBeenCalled();
  });

  it("SC-J3: without a configured secret the job routes do not exist", async () => {
    const ctx = setup({ jobsSecret: null });
    const res = await callJob(ctx, "plan-notifications", `Bearer ${SECRET}`);
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("RouteNotFound");
  });

  it("the jobs secret never authorizes a user route", async () => {
    const ctx = setup({ jobsSecret: SECRET });
    const response = await ctx.handler(
      new Request("http://x/api/me/today", { headers: { authorization: `Bearer ${SECRET}` } }),
    );
    expect(response.status).toBe(401);
  });

  it("answers no CORS: a browser can never call a job route", async () => {
    const ctx = setup({ jobsSecret: SECRET });
    const res = await callJob(ctx, "plan-notifications", `Bearer ${SECRET}`, "POST", {
      origin: "https://app.example",
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("constantTimeEqual", () => {
  it("compares whole values, whatever their lengths", async () => {
    expect(await constantTimeEqual(SECRET, SECRET)).toBe(true);
    expect(await constantTimeEqual(SECRET, `${SECRET}x`)).toBe(false);
    expect(await constantTimeEqual(SECRET, SECRET.replace("s", "t"))).toBe(false);
    expect(await constantTimeEqual("", SECRET)).toBe(false);
  });
});
