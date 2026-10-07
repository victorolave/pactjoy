import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import type { SeasonDto } from "../ports/wire.ts";
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
  it("rejects concurrent editCommitment with 409 ConcurrencyConflict but allows sequential calls", async () => {
    const api = new FakePactJoyApi({ state: "noCircle" });
    const initialSeason: SeasonDto = {
      id: "s1",
      circleId: "c1",
      timeZone: "UTC",
      nominalStart: "2026-10-07",
      actualStart: null,
      lengthWeeks: 8,
      reviewCadenceWeeks: 2,
      status: "pactOpen" as const,
      approvals: [],
      pactClosedAt: null,
      createdAt: "2026-10-06T00:00:00.000Z",
      version: 1,
      pactRevision: 0,
      commitments: [
        {
          id: "c1",
          memberId: "m1",
          habitId: "h1",
          weightPercent: 50,
          privacy: "visible" as const,
          kind: "detail" as const,
          measure: {
            unit: "done" as const,
            schedule: {
              period: "perSession" as const,
              frequency: { kind: "timesPerWeek" as const, times: 3 },
            },
          },
        },
        {
          id: "c2",
          memberId: "m1",
          habitId: "h2",
          weightPercent: 50,
          privacy: "visible" as const,
          kind: "detail" as const,
          measure: {
            unit: "done" as const,
            schedule: {
              period: "perSession" as const,
              frequency: { kind: "timesPerWeek" as const, times: 3 },
            },
          },
        },
      ],
    };
    api.setPactResponse("getSeason", initialSeason);

    const input1 = {
      weightPercent: 60,
      privacy: "visible" as const,
      measure: { unit: "done" as const, frequency: { kind: "timesPerWeek" as const, times: 3 } },
    };
    const input2 = {
      weightPercent: 40,
      privacy: "visible" as const,
      measure: { unit: "done" as const, frequency: { kind: "timesPerWeek" as const, times: 3 } },
    };

    // Parallel calls fail with 409 ConcurrencyConflict
    await expect(
      Promise.all([api.editCommitment("s1", "c1", input1), api.editCommitment("s1", "c2", input2)]),
    ).rejects.toMatchObject({ code: "ConcurrencyConflict", status: 409 });

    // Sequential calls succeed and update the version
    const res1 = await api.editCommitment("s1", "c1", input1);
    expect(res1.version).toBe(3);
    expect(res1.commitments.find((c) => c.id === "c1")?.weightPercent).toBe(60);

    const res2 = await api.editCommitment("s1", "c2", input2);
    expect(res2.version).toBe(4);
    expect(res2.commitments.find((c) => c.id === "c2")?.weightPercent).toBe(40);
  });
});
