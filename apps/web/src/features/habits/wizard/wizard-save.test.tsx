import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { habitsKey, myCircleKey, seasonKey, todayKey } from "../../../shared/query-keys.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { useSaveWizard } from "../queries.ts";
import { wizardHabit, wizardSeason } from "./wizard-fixtures.ts";
import { initialWizard, prefillWizard } from "./wizard-model.ts";

function setup(existing = false) {
  let save: ReturnType<typeof useSaveWizard> | undefined;
  function Probe() {
    save = useSaveWizard(wizardSeason.id, existing ? wizardHabit : undefined);
    return null;
  }
  const { deps } = renderInProviders(<Probe />);
  deps.api.setPactResponse("createHabit", { ...wizardHabit, why: null });
  deps.api.setPactResponse("updateHabit", { ...wizardHabit, version: 4, name: "Lectura" });
  deps.api.setPactResponse("addCommitment", { ...wizardSeason, version: 2 });
  deps.api.setPactResponse("editCommitment", { ...wizardSeason, version: 2 });
  deps.queryClient.setQueryData(habitsKey, existing ? [wizardHabit] : []);
  for (const key of [seasonKey(wizardSeason.id), todayKey, myCircleKey])
    deps.queryClient.setQueryData(key, {});
  const result = {
    get current() {
      if (!save) throw new Error("Save hook required");
      return save;
    },
  };
  return { deps, result };
}

describe("wizard save orchestration", () => {
  it("creates the habit before adding a provisional 5 percent commitment, and caches responses", async () => {
    const { deps, result } = setup();
    const release = deps.api.hold("createHabit");
    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({ draft: initialWizard() });
    });
    expect(deps.api.calls.addCommitment).toBe(0);
    await act(async () => {
      release();
      await pending;
    });
    expect(deps.api.pactCommands.map((c) => c.method)).toEqual(["createHabit", "addCommitment"]);
    expect(deps.api.pactCommands[1]?.args).toEqual([
      wizardSeason.id,
      {
        habitId: wizardHabit.id,
        weightPercent: 5,
        privacy: "visible",
        measure: initialWizard().measure,
      },
    ]);
    expect(deps.queryClient.getQueryData(habitsKey)).toEqual([{ ...wizardHabit, why: null }]);
    expect(deps.queryClient.getQueryData(seasonKey(wizardSeason.id))).toEqual({
      ...wizardSeason,
      version: 2,
    });
    for (const key of [seasonKey(wizardSeason.id), todayKey, myCircleKey])
      expect(deps.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it("reuses the created habit if adding the commitment fails and is retried", async () => {
    const { deps, result } = setup();
    deps.api.failNext("addCommitment", new ApiError("ConcurrencyConflict", 409, null));
    await act(async () => {
      await expect(result.current.mutateAsync({ draft: initialWizard() })).rejects.toThrow();
    });
    await act(async () => {
      await result.current.mutateAsync({ draft: initialWizard() });
    });
    expect(deps.api.calls.createHabit).toBe(1);
    expect(deps.api.calls.addCommitment).toBe(2);
    expect(deps.queryClient.getQueryData(habitsKey)).toEqual([{ ...wizardHabit, why: null }]);
  });

  it("skips unchanged metadata when reusing a habit and when editing a commitment", async () => {
    const { deps, result } = setup(true);
    const commitment = wizardSeason.commitments[0];
    if (commitment?.kind !== "detail") throw new Error("Detail fixture required");
    await act(async () => {
      await result.current.mutateAsync({
        draft: prefillWizard(wizardHabit, commitment),
        commitment,
      });
    });
    expect(deps.api.pactCommands.map((c) => c.method)).toEqual(["editCommitment"]);
    expect(deps.api.pactCommands[0]?.args).toEqual([
      wizardSeason.id,
      commitment.id,
      {
        weightPercent: 25,
        privacy: "private",
        measure: prefillWizard(wizardHabit, commitment).measure,
      },
    ]);
    await act(async () => {
      await result.current.mutateAsync({ draft: prefillWizard(wizardHabit) });
    });
    expect(deps.api.pactCommands[1]?.args).toEqual([
      wizardSeason.id,
      {
        habitId: wizardHabit.id,
        weightPercent: 5,
        privacy: "visible",
        measure: prefillWizard(wizardHabit).measure,
      },
    ]);
  });

  it("awaits changed-only PATCH before PUT and keeps the updated habit/version on retry", async () => {
    const { deps, result } = setup(true);
    const commitment = wizardSeason.commitments[0];
    if (commitment?.kind !== "detail") throw new Error("Detail fixture required");
    const draft = { ...prefillWizard(wizardHabit, commitment), name: "Lectura" };
    const release = deps.api.hold("updateHabit");
    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({ draft, commitment });
    });
    expect(deps.api.calls.editCommitment).toBe(0);
    await act(async () => {
      release();
      await pending;
    });
    expect(deps.api.pactCommands[0]?.args).toEqual([
      wizardHabit.id,
      { expectedVersion: 3, name: "Lectura" },
    ]);
    expect(deps.queryClient.getQueryData(habitsKey)).toEqual([
      { ...wizardHabit, version: 4, name: "Lectura" },
    ]);
    await act(async () => {
      await result.current.mutateAsync({ draft, commitment });
    });
    expect(deps.api.calls.updateHabit).toBe(1);
    expect(deps.api.calls.editCommitment).toBe(2);
  });
});
