import { describe, expect, it } from "vitest";
import { JOBS, runTick } from "../scripts/jobs-tick-run.ts";

/** The local trigger (ADR-0017, REQ-J8): the four jobs, in order, with the secret, nothing else. */

const SECRET = "x".repeat(40);

function recorder(status = 200) {
  const calls: { url: string; method: string; authorization: string | undefined }[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ url, method: init.method, authorization: init.headers.authorization });
    return {
      status,
      text: async () => JSON.stringify({ data: { ok: url.split("/").pop() } }),
    };
  };
  return { calls, fetch };
}

describe("runTick", () => {
  it("POSTs settle, sweep, plan and dispatch in that order with the bearer secret", async () => {
    const { calls, fetch } = recorder();
    const lines = await runTick({
      baseUrl: "http://127.0.0.1:54321/functions/v1/api",
      secret: SECRET,
      fetch,
    });
    expect(JOBS).toEqual([
      "settle-due-pauses",
      "sweep-entry-photos",
      "plan-notifications",
      "dispatch-notifications",
    ]);
    expect(calls).toEqual(
      JOBS.map((job) => ({
        url: `http://127.0.0.1:54321/functions/v1/api/jobs/${job}`,
        method: "POST",
        authorization: `Bearer ${SECRET}`,
      })),
    );
    expect(lines).toEqual(JOBS.map((job) => `${job} 200 {"ok":"${job}"}`));
  });

  it("tolerates a trailing slash on the base URL", async () => {
    const { calls, fetch } = recorder();
    await runTick({ baseUrl: "http://h/api/", secret: SECRET, fetch });
    expect(calls[0]?.url).toBe("http://h/api/jobs/settle-due-pauses");
  });

  it("reports a failing job and still runs the next ones, never printing the secret", async () => {
    const { calls, fetch } = recorder(401);
    const lines = await runTick({ baseUrl: "http://h/api", secret: SECRET, fetch });
    expect(calls).toHaveLength(4);
    expect(lines.every((line) => line.includes(" 401 "))).toBe(true);
    expect(lines.join("\n")).not.toContain(SECRET);
  });
});
