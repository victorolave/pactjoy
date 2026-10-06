import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { FakePactJoyApi } from "./fake-pactjoy-api.ts";

describe("FakePactJoyApi pact scripting", () => {
  it("returns a typed scripted habit and records its command without simulating domain rules", async () => {
    const api = new FakePactJoyApi({ state: "noCircle" });
    const habit = {
      id: "h1",
      name: "Leer",
      why: "Learn",
      category: "Leer",
      icon: "book",
      createdAt: "2026-10-06T00:00:00.000Z",
      version: 0,
    };
    api.setPactResponse("createHabit", habit);
    const input = { name: "Leer", icon: "book" };
    expect(await api.createHabit(input)).toEqual(habit);
    expect(api.pactCommands).toEqual([{ method: "createHabit", args: [input] }]);
  });
  it("records calls, holds responses and queues failures just like the existing fake", async () => {
    const api = new FakePactJoyApi({ state: "noCircle" });
    api.setPactResponse("listHabits", []);
    const release = api.hold("listHabits");
    const pending = api.listHabits();
    expect(api.calls.listHabits).toBe(1);
    release();
    expect(await pending).toEqual([]);
    api.failNext("listHabits", new ApiError("NetworkError", 0, null));
    await expect(api.listHabits()).rejects.toMatchObject({ code: "NetworkError" });
    expect(api.pactCommands).toEqual([
      { method: "listHabits", args: [] },
      { method: "listHabits", args: [] },
    ]);
  });
  it("does not invent a mutation response when a scenario was not configured", async () => {
    const api = new FakePactJoyApi({ state: "noCircle" });
    await expect(api.approvePact("s1", 3)).rejects.toThrow("approvePact");
    expect(api.pactCommands).toEqual([{ method: "approvePact", args: ["s1", 3] }]);
  });
});
