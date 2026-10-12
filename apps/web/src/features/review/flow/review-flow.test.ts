import { describe, expect, it } from "vitest";
import {
  buildSubmission,
  canAdvance,
  type FlowConfig,
  type FlowState,
  initialFlowState,
  isFirstScreen,
  isLastCommitment,
  progressBars,
  reviewFlowReducer,
} from "./review-flow.ts";

const FULL: FlowConfig = { kind: "interim", srbai: "full", commitmentIds: ["a", "b"] };
const ITEM_ONE: FlowConfig = { kind: "interim", srbai: "item1", commitmentIds: ["a", "b", "c"] };
const BASELINE: FlowConfig = { kind: "baseline", srbai: "full", commitmentIds: ["a", "b"] };

const run = (config: FlowConfig, ...actions: Parameters<typeof reviewFlowReducer>[2][]) =>
  actions.reduce<FlowState>(
    (state, action) => reviewFlowReducer(state, config, action),
    initialFlowState(config),
  );

const answerAll = (id: string, score = 5) =>
  [0, 1, 2, 3].map((item) => ({ type: "answer" as const, commitmentId: id, item, score }));

describe("the steps", () => {
  it("starts an interim review on the summary and the baseline straight on the questions", () => {
    expect(initialFlowState(FULL).step).toBe("summary");
    expect(initialFlowState(BASELINE).step).toBe("srbai");
  });

  it("walks summary, reflection and questions, and back again", () => {
    const atQuestions = run(FULL, { type: "next" }, { type: "next" });
    expect(atQuestions.step).toBe("srbai");
    expect(run(FULL, { type: "next" }, { type: "next" }, { type: "back" }).step).toBe("reflection");
    expect(run(FULL, { type: "next" }, { type: "back" }).step).toBe("summary");
  });

  it("'Saltar' skips only the reflection: it empties both fields and goes to the questions", () => {
    const state = run(
      FULL,
      { type: "next" },
      { type: "reflect", field: "helped", value: "Leer de noche" },
      { type: "reflect", field: "hard", value: "El gym" },
      { type: "skipReflection" },
    );
    expect(state).toMatchObject({ step: "srbai", helped: "", hard: "" });
  });

  it("knows the first screen, where back leaves the flow", () => {
    expect(isFirstScreen(initialFlowState(FULL))).toBe(true);
    expect(isFirstScreen(initialFlowState(BASELINE))).toBe(true);
    expect(isFirstScreen(run(FULL, { type: "next" }))).toBe(false);
    expect(isFirstScreen(run(BASELINE, ...answerAll("a"), { type: "next" }))).toBe(false);
  });
});

describe("full SRBAI, one commitment per screen", () => {
  it("needs all four answers of the commitment on screen before moving on", () => {
    let state = run(FULL, { type: "next" }, { type: "next" });
    expect(canAdvance(state, FULL)).toBe(false);
    state = reviewFlowReducer(state, FULL, { type: "next" });
    expect(state.index).toBe(0);
    for (const action of answerAll("a").slice(0, 3)) state = reviewFlowReducer(state, FULL, action);
    expect(canAdvance(state, FULL)).toBe(false);
    state = reviewFlowReducer(state, FULL, answerAll("a")[3] as never);
    expect(canAdvance(state, FULL)).toBe(true);
    state = reviewFlowReducer(state, FULL, { type: "next" });
    expect(state.index).toBe(1);
  });

  it("goes back one commitment at a time and then to the reflection", () => {
    const base = [
      { type: "next" as const },
      { type: "next" as const },
      ...answerAll("a"),
      { type: "next" as const },
    ];
    const second = run(FULL, ...base);
    expect(second.index).toBe(1);
    const first = reviewFlowReducer(second, FULL, { type: "back" });
    expect(first).toMatchObject({ step: "srbai", index: 0 });
    expect(reviewFlowReducer(first, FULL, { type: "back" }).step).toBe("reflection");
  });

  it("flags the last commitment, and 'next' there does not move past it", () => {
    const atLast = run(
      FULL,
      { type: "next" },
      { type: "next" },
      ...answerAll("a"),
      { type: "next" },
      ...answerAll("b"),
    );
    expect(isLastCommitment(atLast, FULL)).toBe(true);
    expect(canAdvance(atLast, FULL)).toBe(true);
    expect(reviewFlowReducer(atLast, FULL, { type: "next" }).index).toBe(1);
  });

  it("keeps an answer that is changed, one slot at a time", () => {
    const state = run(
      FULL,
      { type: "next" },
      { type: "next" },
      { type: "answer", commitmentId: "a", item: 1, score: 3 },
      { type: "answer", commitmentId: "a", item: 1, score: 6 },
    );
    expect(state.answers.a).toEqual([null, 6, null, null]);
  });
});

describe("item 1 only, every commitment on one screen", () => {
  it("is complete only when every commitment has its item 1", () => {
    let state = run(ITEM_ONE, { type: "next" }, { type: "next" });
    expect(canAdvance(state, ITEM_ONE)).toBe(false);
    state = reviewFlowReducer(state, ITEM_ONE, {
      type: "answer",
      commitmentId: "a",
      item: 0,
      score: 5,
    });
    state = reviewFlowReducer(state, ITEM_ONE, {
      type: "answer",
      commitmentId: "b",
      item: 0,
      score: 3,
    });
    expect(canAdvance(state, ITEM_ONE)).toBe(false);
    state = reviewFlowReducer(state, ITEM_ONE, {
      type: "answer",
      commitmentId: "c",
      item: 0,
      score: 4,
    });
    expect(canAdvance(state, ITEM_ONE)).toBe(true);
  });

  it("treats the whole screen as the last one", () => {
    expect(isLastCommitment(run(ITEM_ONE, { type: "next" }, { type: "next" }), ITEM_ONE)).toBe(
      true,
    );
  });
});

describe("progress bars", () => {
  it("shows three bars for an interim review and one per commitment for the baseline", () => {
    expect(progressBars(initialFlowState(FULL), FULL)).toEqual({ current: 0, total: 3 });
    expect(progressBars(run(FULL, { type: "next" }), FULL)).toEqual({ current: 1, total: 3 });
    expect(progressBars(run(FULL, { type: "next" }, { type: "next" }), FULL)).toEqual({
      current: 2,
      total: 3,
    });
    expect(progressBars(initialFlowState(BASELINE), BASELINE)).toEqual({ current: 0, total: 2 });
    expect(progressBars(run(BASELINE, ...answerAll("a"), { type: "next" }), BASELINE)).toEqual({
      current: 1,
      total: 2,
    });
  });
});

describe("the submission", () => {
  it("sends four slots per commitment, in season order, with the reflection trimmed", () => {
    const state = run(
      FULL,
      { type: "next" },
      { type: "reflect", field: "helped", value: "  Con calma  " },
      { type: "reflect", field: "hard", value: "   " },
      { type: "next" },
      ...answerAll("a", 5),
      ...answerAll("b", 3),
    );
    expect(buildSubmission(state, FULL)).toEqual({
      reflection: { helped: "Con calma", hard: null },
      automaticity: [
        { commitmentId: "a", items: [5, 5, 5, 5] },
        { commitmentId: "b", items: [3, 3, 3, 3] },
      ],
    });
  });

  it("fills only item 1 for an item-1 review and sends no reflection for the baseline", () => {
    const itemOne = run(
      ITEM_ONE,
      { type: "next" },
      { type: "next" },
      { type: "answer", commitmentId: "a", item: 0, score: 4 },
      { type: "answer", commitmentId: "b", item: 0, score: 6 },
      { type: "answer", commitmentId: "c", item: 0, score: 1 },
    );
    expect(buildSubmission(itemOne, ITEM_ONE).automaticity).toEqual([
      { commitmentId: "a", items: [4, null, null, null] },
      { commitmentId: "b", items: [6, null, null, null] },
      { commitmentId: "c", items: [1, null, null, null] },
    ]);
    const baseline = run(BASELINE, ...answerAll("a"), ...answerAll("b"));
    expect(buildSubmission(baseline, BASELINE).reflection).toEqual({ helped: null, hard: null });
  });
});

describe("failures send the member back", () => {
  it("shows the reflection or the questions on demand", () => {
    const state = run(FULL, { type: "next" }, { type: "next" });
    expect(reviewFlowReducer(state, FULL, { type: "show", step: "reflection" }).step).toBe(
      "reflection",
    );
    expect(reviewFlowReducer(state, FULL, { type: "show", step: "srbai" })).toMatchObject({
      step: "srbai",
      index: 0,
    });
  });
});
