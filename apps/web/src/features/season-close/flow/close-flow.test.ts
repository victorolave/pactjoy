import { describe, expect, it } from "vitest";
import {
  buildCommand,
  type CloseFlowConfig,
  type CloseFlowState,
  closeFlowReducer,
  continueFrom,
  graduatedIds,
  initialCloseState,
  isLastHabit,
  progressBars,
} from "./close-flow.ts";

const config: CloseFlowConfig = { commitmentIds: ["a", "b", "c"] };

const run = (
  actions: readonly Parameters<typeof closeFlowReducer>[2][],
  from: CloseFlowState = initialCloseState(),
): CloseFlowState =>
  actions.reduce((state, action) => closeFlowReducer(state, config, action), from);

const atDecisions = (): CloseFlowState => run([{ type: "start" }]);

describe("the close flow", () => {
  it("starts on the results and opens the first habit", () => {
    expect(initialCloseState().step).toBe("results");
    const state = atDecisions();
    expect(state).toMatchObject({ step: "decide", index: 0 });
  });

  it("keeps one decision per habit and replaces it when the member changes their mind", () => {
    const state = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "continue" },
      { type: "choose", commitmentId: "a", decision: "adjust" },
    ]);
    expect(state.decisions).toEqual({ a: "adjust" });
  });

  it("cannot continue before choosing, and moves one habit at a time", () => {
    const start = atDecisions();
    expect(continueFrom(start, config)).toBe("blocked");
    const chosen = run([{ type: "choose", commitmentId: "a", decision: "continue" }], start);
    expect(continueFrom(chosen, config)).toBe("next");
    expect(run([{ type: "advance" }], chosen).index).toBe(1);
  });

  it("saves from the last habit and never advances past it", () => {
    const state = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "continue" },
      { type: "advance" },
      { type: "choose", commitmentId: "b", decision: "pause" },
      { type: "advance" },
      { type: "choose", commitmentId: "c", decision: "adjust" },
    ]);
    expect(isLastHabit(state, config)).toBe(true);
    expect(continueFrom(state, config)).toBe("save");
    expect(run([{ type: "advance" }], state).index).toBe(2);
  });

  it("asks to confirm a graduation once, then lets the member go on", () => {
    const chosen = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "graduate" },
    ]);
    expect(continueFrom(chosen, config)).toBe("confirm");
    const asking = run([{ type: "openSheet" }], chosen);
    expect(asking.sheet).toBe(true);
    const confirmed = run([{ type: "confirmGraduate" }], asking);
    expect(confirmed.sheet).toBe(false);
    expect(continueFrom(confirmed, config)).toBe("next");
  });

  it("'Todavía no' drops the graduation and leaves the member to choose again", () => {
    const asking = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "graduate" },
      { type: "openSheet" },
      { type: "dismissSheet" },
    ]);
    expect(asking.sheet).toBe(false);
    expect(asking.decisions).toEqual({});
    expect(continueFrom(asking, config)).toBe("blocked");
  });

  it("asks again when the member returns to graduate after choosing something else", () => {
    const state = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "graduate" },
      { type: "openSheet" },
      { type: "confirmGraduate" },
      { type: "choose", commitmentId: "a", decision: "continue" },
      { type: "choose", commitmentId: "a", decision: "graduate" },
    ]);
    expect(continueFrom(state, config)).toBe("confirm");
  });

  it("goes back a habit with its choice kept, and from the first habit to the results", () => {
    const state = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "continue" },
      { type: "advance" },
      { type: "back" },
    ]);
    expect(state).toMatchObject({ step: "decide", index: 0 });
    expect(state.decisions).toEqual({ a: "continue" });
    expect(run([{ type: "back" }], state).step).toBe("results");
  });

  it("closes an open sheet when going back", () => {
    const state = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "graduate" },
      { type: "openSheet" },
      { type: "back" },
    ]);
    expect(state.sheet).toBe(false);
  });

  it("lists the graduated habits in the order of the commitments", () => {
    const state = run([
      { type: "start" },
      { type: "choose", commitmentId: "c", decision: "graduate" },
      { type: "choose", commitmentId: "a", decision: "graduate" },
      { type: "choose", commitmentId: "b", decision: "continue" },
    ]);
    expect(graduatedIds(state, config)).toEqual(["a", "c"]);
  });

  it("after saving, celebrates each graduated habit and then shows the summary", () => {
    const decided = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "graduate" },
      { type: "choose", commitmentId: "b", decision: "continue" },
      { type: "choose", commitmentId: "c", decision: "graduate" },
    ]);
    const saved = run([{ type: "saved" }], decided);
    expect(saved).toMatchObject({ step: "celebrate", celebration: 0 });
    const second = run([{ type: "nextCelebration" }], saved);
    expect(second).toMatchObject({ step: "celebrate", celebration: 1 });
    expect(run([{ type: "nextCelebration" }], second).step).toBe("summary");
  });

  it("goes straight to the summary after saving when nothing was graduated", () => {
    const decided = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "continue" },
    ]);
    expect(run([{ type: "saved" }], decided).step).toBe("summary");
  });

  it("builds the command in commitment order, only when every habit has a decision", () => {
    const partial = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "continue" },
    ]);
    expect(buildCommand(partial, config)).toBeNull();
    const full = run(
      [
        { type: "choose", commitmentId: "c", decision: "adjust" },
        { type: "choose", commitmentId: "b", decision: "pause" },
      ],
      partial,
    );
    expect(buildCommand(full, config)).toEqual({
      decisions: [
        { commitmentId: "a", decision: "continue" },
        { commitmentId: "b", decision: "pause" },
        { commitmentId: "c", decision: "adjust" },
      ],
    });
  });

  it("fills one bar per habit on the decision step", () => {
    const state = run([
      { type: "start" },
      { type: "choose", commitmentId: "a", decision: "continue" },
      { type: "advance" },
    ]);
    expect(progressBars(state, config)).toEqual({ current: 1, total: 3 });
  });
});
