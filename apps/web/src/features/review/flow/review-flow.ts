import type { SubmitReviewCommand } from "../../../ports/pactjoy-api.ts";

/**
 * The state machine behind the review route (change periodic-review, ADR-0014). Interim and
 * closing reviews walk summary (33), reflection (34) and the SRBAI questions (35a or 35c); the
 * baseline (13) is the questions alone. Pure: the screen owns the network, this owns the steps.
 * Nothing here is persisted: closing the flow discards the draft and the review stays due.
 */
export type FlowStep = "summary" | "reflection" | "srbai" | "done";

export interface FlowConfig {
  readonly kind: "baseline" | "interim" | "closing";
  /** `full`: four items, one commitment per screen. `item1`: item 1, every commitment on one screen. */
  readonly srbai: "full" | "item1";
  /** The member's commitments, in the order the server listed them. */
  readonly commitmentIds: readonly string[];
}

type Slots = readonly (number | null)[];

export interface FlowState {
  readonly step: FlowStep;
  readonly first: "summary" | "srbai";
  /** Full SRBAI: the commitment on screen. */
  readonly index: number;
  readonly helped: string;
  readonly hard: string;
  /** commitmentId to its four slots. */
  readonly answers: Readonly<Record<string, Slots>>;
}

export type FlowAction =
  | { readonly type: "next" }
  | { readonly type: "back" }
  | { readonly type: "skipReflection" }
  | { readonly type: "reflect"; readonly field: "helped" | "hard"; readonly value: string }
  | {
      readonly type: "answer";
      readonly commitmentId: string;
      readonly item: number;
      readonly score: number;
    }
  | { readonly type: "show"; readonly step: "summary" | "reflection" | "srbai" }
  | { readonly type: "done" };

const SLOTS = 4;
const EMPTY: Slots = [null, null, null, null];

export function initialFlowState(config: FlowConfig): FlowState {
  const first = config.kind === "baseline" ? "srbai" : "summary";
  return { step: first, first, index: 0, helped: "", hard: "", answers: {} };
}

/** Items a commitment must answer before the review can be saved. */
const requiredItems = (config: FlowConfig): readonly number[] =>
  config.srbai === "full" ? [0, 1, 2, 3] : [0];

const isAnswered = (state: FlowState, config: FlowConfig, commitmentId: string): boolean => {
  const slots = state.answers[commitmentId] ?? EMPTY;
  return requiredItems(config).every((item) => slots[item] != null);
};

/** Full: the commitment on screen. Item 1: every commitment. */
export function canAdvance(state: FlowState, config: FlowConfig): boolean {
  if (config.srbai === "item1") {
    return config.commitmentIds.every((id) => isAnswered(state, config, id));
  }
  const current = config.commitmentIds[state.index];
  return current !== undefined && isAnswered(state, config, current);
}

export function isLastCommitment(state: FlowState, config: FlowConfig): boolean {
  return config.srbai === "item1" || state.index >= config.commitmentIds.length - 1;
}

/** On the first screen "back" leaves the flow instead of moving inside it. */
export function isFirstScreen(state: FlowState): boolean {
  return state.step === state.first && state.index === 0;
}

/** Three bars for the summary, the reflection and the questions; the baseline has one per commitment. */
export function progressBars(
  state: FlowState,
  config: FlowConfig,
): { readonly current: number; readonly total: number } {
  if (config.kind === "baseline") {
    return { current: state.index, total: Math.max(1, config.commitmentIds.length) };
  }
  const current = state.step === "summary" ? 0 : state.step === "reflection" ? 1 : 2;
  return { current, total: 3 };
}

export function reviewFlowReducer(
  state: FlowState,
  config: FlowConfig,
  action: FlowAction,
): FlowState {
  switch (action.type) {
    case "next":
      if (state.step === "summary") return { ...state, step: "reflection" };
      if (state.step === "reflection") return { ...state, step: "srbai", index: 0 };
      if (state.step === "srbai" && config.srbai === "full") {
        if (!canAdvance(state, config) || isLastCommitment(state, config)) return state;
        return { ...state, index: state.index + 1 };
      }
      return state;
    case "back":
      if (state.step === "reflection") return { ...state, step: "summary" };
      if (state.step === "srbai") {
        if (state.index > 0) return { ...state, index: state.index - 1 };
        return state.first === "srbai" ? state : { ...state, step: "reflection" };
      }
      return state;
    case "skipReflection":
      return { ...state, helped: "", hard: "", step: "srbai", index: 0 };
    case "reflect":
      return { ...state, [action.field]: action.value };
    case "answer": {
      if (action.item < 0 || action.item >= SLOTS) return state;
      const slots = [...(state.answers[action.commitmentId] ?? EMPTY)];
      slots[action.item] = action.score;
      return { ...state, answers: { ...state.answers, [action.commitmentId]: slots } };
    }
    case "show":
      return { ...state, step: action.step, index: 0 };
    case "done":
      return { ...state, step: "done" };
  }
}

const textOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/** The body of `POST /seasons/:id/reviews/:k`: always four slots; the baseline carries no reflection. */
export function buildSubmission(state: FlowState, config: FlowConfig): SubmitReviewCommand {
  const reflection =
    config.kind === "baseline"
      ? { helped: null, hard: null }
      : { helped: textOrNull(state.helped), hard: textOrNull(state.hard) };
  return {
    reflection,
    automaticity: config.commitmentIds.map((commitmentId) => {
      const slots = state.answers[commitmentId] ?? EMPTY;
      const items = requiredItems(config);
      return {
        commitmentId,
        items: [0, 1, 2, 3].map((item) =>
          items.includes(item) ? (slots[item] ?? null) : null,
        ) as [number | null, number | null, number | null, number | null],
      };
    }),
  };
}
