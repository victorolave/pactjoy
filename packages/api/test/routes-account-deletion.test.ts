import { ConcurrencyConflict } from "@pactjoy/app";
import { describe, expect, it, vi } from "vitest";
import { createCircleBody } from "../src/testing/index.ts";
import { ANDREA, setup } from "./harness.ts";

const CONFIRM = { confirmation: "ELIMINAR" };
const SECRET = `${"s".repeat(24)}-job-secret-1234`;

describe("DELETE /me (ADR-0019)", () => {
  it("401 without a token and with an unknown one, and nothing is erased", async () => {
    const { call, app, transaction } = setup();
    const none = await call("DELETE", "/me", null, CONFIRM);
    const bad = await call("DELETE", "/me", "nobody", CONFIRM);
    expect([none.status, bad.status]).toEqual([401, 401]);
    expect(transaction).not.toHaveBeenCalled();
    expect(app.identity.deleted).toEqual([]);
  });

  it("200 {data: null} erases the data, then the identity of the caller (and only theirs)", async () => {
    const { call, app } = setup();
    await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    expect((await call("GET", "/me/circle", "andrea")).json.data.circle).not.toBeNull();

    const res = await call("DELETE", "/me", "andrea", CONFIRM);
    expect([res.status, res.json]).toEqual([200, { data: null }]);
    expect(app.identity.deleted).toEqual([ANDREA]);
    // The membership is gone: the old token finds no circle.
    expect((await call("GET", "/me/circle", "andrea")).json.data.circle).toBeNull();
  });

  it("logs the event with no id, name or body", async () => {
    const info = vi.fn();
    const { call } = setup({ logger: { info, warn: vi.fn(), error: vi.fn() } });
    await call("DELETE", "/me", "andrea", CONFIRM);
    const lines = info.mock.calls.filter(([event]) => event === "accountDeleted");
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toMatch(/ELIMINAR|aaaaaaaa/);
  });

  it("a wrong word is 422 ConfirmationMismatch, case sensitive, with no transaction and no identity call", async () => {
    for (const confirmation of ["eliminar", "ELIMINA", "", "BORRAR"]) {
      const { call, app, transaction } = setup();
      const res = await call("DELETE", "/me", "andrea", { confirmation });
      expect([res.status, res.json.error.code]).toEqual([422, "ConfirmationMismatch"]);
      expect(transaction).not.toHaveBeenCalled();
      expect(app.identity.deleted).toEqual([]);
    }
  });

  it("a missing body, a wrong type, a missing field and an unknown field are 422 InvalidRequest", async () => {
    const { call, app, transaction } = setup();
    const bodies: unknown[] = [undefined, { confirmation: 5 }, {}, { ...CONFIRM, extra: true }];
    for (const body of bodies) {
      const res = await call("DELETE", "/me", "andrea", body);
      expect([res.status, res.json.error.code]).toEqual([422, "InvalidRequest"]);
    }
    expect(transaction).not.toHaveBeenCalled();
    expect(app.identity.deleted).toEqual([]);
  });

  it("the identity provider down is 503 IdentityUnavailable: the data stays erased and a retry finishes", async () => {
    const { call, app } = setup();
    await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    app.identity.setFailure("unavailable");

    const first = await call("DELETE", "/me", "andrea", CONFIRM);
    expect([first.status, first.json.error.code]).toEqual([503, "IdentityUnavailable"]);
    expect(app.identity.deleted).toEqual([]);
    expect((await call("GET", "/me/circle", "andrea")).json.data.circle).toBeNull();

    app.identity.setFailure(null);
    const retry = await call("DELETE", "/me", "andrea", CONFIRM);
    expect([retry.status, retry.json]).toEqual([200, { data: null }]);
    expect(app.identity.deleted).toEqual([ANDREA]);
  });

  it("a rejected admin credential is the same 503, never a 401 or 500 that leaks the cause", async () => {
    const { call, app } = setup();
    app.identity.setFailure("rejected");
    const res = await call("DELETE", "/me", "andrea", CONFIRM);
    expect([res.status, res.json.error.code]).toEqual([503, "IdentityUnavailable"]);
  });

  it("a concurrency conflict in the transaction is 409 ConcurrencyConflict and the identity is untouched", async () => {
    const { call, app, transaction } = setup();
    transaction.mockRejectedValueOnce(new ConcurrencyConflict());
    const res = await call("DELETE", "/me", "andrea", CONFIRM);
    expect([res.status, res.json.error.code]).toEqual([409, "ConcurrencyConflict"]);
    expect(app.identity.deleted).toEqual([]);
  });

  it("without a configured admin key it is 503 ServiceUnavailable before anything is written", async () => {
    const { call, transaction, read } = setup({ identity: null });
    await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    transaction.mockClear();
    const res = await call("DELETE", "/me", "andrea", CONFIRM);
    expect([res.status, res.json.error.code]).toEqual([503, "ServiceUnavailable"]);
    expect(transaction).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    // The data is intact.
    expect((await call("GET", "/me/circle", "andrea")).json.data.circle).not.toBeNull();
  });

  it("other DELETE routes still refuse a body", async () => {
    const { call } = setup();
    const res = await call(
      "DELETE",
      "/seasons/aaaaaaaa-0000-4000-8000-0000000000aa/approval",
      "andrea",
      CONFIRM,
    );
    expect([res.status, res.json.error.details]).toEqual([422, { reason: "bodyNotAllowed" }]);
  });

  it("the job pipeline never reaches it: the jobs secret is no user and /jobs has no such route", async () => {
    const { handler, app, transaction } = setup({ jobsSecret: SECRET });
    const asJob = await handler(
      new Request("http://x/api/jobs/me", {
        method: "DELETE",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
        body: JSON.stringify(CONFIRM),
      }),
    );
    expect(asJob.status).toBe(404);
    const asUser = await handler(
      new Request("http://x/api/me", {
        method: "DELETE",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
        body: JSON.stringify(CONFIRM),
      }),
    );
    expect(asUser.status).toBe(401);
    expect(transaction).not.toHaveBeenCalled();
    expect(app.identity.deleted).toEqual([]);
  });
});
