import { describe, expect, it } from "vitest";
import { ANDREA, setup } from "./harness.ts";

describe("POST /habits (UE-C-S9)", () => {
  it("S9: 201 with the habit owned by the caller (owner never echoed)", async () => {
    const { app, call } = setup();
    const { status, json } = await call("POST", "/habits", "andrea", {
      name: " Run ",
      why: "Energy",
      category: "health",
    });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ name: "Run", why: "Energy", category: "health" });
    expect(JSON.stringify(json)).not.toContain(ANDREA);
    expect((await app.habits.get(json.data.id))?.ownerId).toBe(ANDREA);
  });

  it("why and category are optional or null", async () => {
    const { call } = setup();
    const bare = await call("POST", "/habits", "andrea", { name: "Read" });
    expect([bare.status, bare.json.data.why, bare.json.data.category]).toEqual([201, null, null]);
    const nulls = await call("POST", "/habits", "andrea", {
      name: "Read",
      why: null,
      category: null,
    });
    expect(nulls.status).toBe(201);
  });

  it("RV-S22: the app owns content rules (NUL in name is InvalidName 422 from the app)", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("POST", "/habits", "andrea", { name: "a\u0000b" });
    expect([status, json.error.code]).toEqual([422, "InvalidName"]);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it.each([
    ["name wrong type", { name: 5 }, "type"],
    ["name missing", {}, "required"],
    ["why wrong type", { name: "x", why: 5 }, "type"],
    ["category wrong type", { name: "x", category: true }, "type"],
    ["unknown field (ownerId is never accepted)", { name: "x", ownerId: ANDREA }, "unknownField"],
    ["no body", undefined, "required"],
  ])(
    "RV-S1/S3, RV-S7, RV-S11: 422 InvalidRequest on %s, no repository call",
    async (_l, body, problem) => {
      const { call, transaction, read } = setup();
      const { status, json } = await call("POST", "/habits", "andrea", body);
      expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
      expect(json.error.details.issues[0].problem).toBe(problem);
      expect(transaction).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("401 without a token", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("POST", "/habits", null, { name: "x" });
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
  });
});
