import type { SubmitClosureCommand } from "../../../ports/pactjoy-api.ts";
import type { ClosureDecisionDto } from "../../../ports/wire.ts";

/**
 * The state machine behind the close route (change season-close-graduation, ADR-0015). The member
 * walks the results (36), then one decision per habit (37, with the graduation question 38a as a
 * sheet), and ONE request saves them all. After it, each graduated habit is celebrated (38b) and
 * the summary closes the flow (37b). Pure: the screen owns the network, this owns the steps.
 * Nothing is stored before the request: leaving the flow discards the draft (REQ-C4).
 */
export type CloseStep = "results" | "decide" | "celebrate" | "summary";

export interface CloseFlowConfig {
  /** The member's commitments, in the order the results listed them. */
  readonly commitmentIds: readonly string[];
}

export interface CloseFlowState {
  readonly step: CloseStep;
  /** The habit on screen in `decide`. */
  readonly index: number;
  readonly decisions: Readonly<Record<string, ClosureDecisionDto>>;
  /** Graduations the member confirmed on the sheet; choosing anything else forgets it. */
  readonly confirmed: Readonly<Record<string, true>>;
  /** The graduation question (38a) is open over the current habit. */
  readonly sheet: boolean;
  /** `celebrate`: which of the graduated habits is on screen. */
  readonly celebration: number;
}

export type CloseFlowAction =
  | { readonly type: "start" }
  | {
      readonly type: "choose";
      readonly commitmentId: string;
      readonly decision: ClosureDecisionDto;
    }
  | { readonly type: "advance" }
  | { readonly type: "back" }
  | { readonly type: "openSheet" }
  | { readonly type: "confirmGraduate" }
  | { readonly type: "dismissSheet" }
  | { readonly type: "saved" }
  | { readonly type: "nextCelebration" };

export function initialCloseState(): CloseFlowState {
  return { step: "results", index: 0, decisions: {}, confirmed: {}, sheet: false, celebration: 0 };
}

const withoutKey = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

const currentId = (state: CloseFlowState, config: CloseFlowConfig): string | undefined =>
  config.commitmentIds[state.index];

export function isLastHabit(state: CloseFlowState, config: CloseFlowConfig): boolean {
  return state.index >= config.commitmentIds.length - 1;
}

/** The habits the member graduates, in the order of the commitments. */
export function graduatedIds(state: CloseFlowState, config: CloseFlowConfig): readonly string[] {
  return config.commitmentIds.filter((id) => state.decisions[id] === "graduate");
}

/**
 * What the button of the habit on screen does:
 * - `blocked`: no decision yet;
 * - `confirm`: a graduation not confirmed yet opens the question (38a);
 * - `save`: the last habit sends every decision;
 * - `next`: on to the next habit.
 */
export function continueFrom(
  state: CloseFlowState,
  config: CloseFlowConfig,
): "blocked" | "confirm" | "save" | "next" {
  const id = currentId(state, config);
  if (id === undefined) return "blocked";
  const decision = state.decisions[id];
  if (decision === undefined) return "blocked";
  if (decision === "graduate" && state.confirmed[id] !== true) return "confirm";
  return isLastHabit(state, config) ? "save" : "next";
}

/** Eight steps of the flow reduce to three bars of progress on the decision step: one per habit. */
export function progressBars(
  state: CloseFlowState,
  config: CloseFlowConfig,
): { readonly current: number; readonly total: number } {
  return { current: state.index, total: Math.max(1, config.commitmentIds.length) };
}

/** The body of `POST /seasons/:id/closure`: one decision per commitment, `null` while one is missing. */
export function buildCommand(
  state: CloseFlowState,
  config: CloseFlowConfig,
): SubmitClosureCommand | null {
  const decisions: { commitmentId: string; decision: ClosureDecisionDto }[] = [];
  for (const commitmentId of config.commitmentIds) {
    const decision = state.decisions[commitmentId];
    if (decision === undefined) return null;
    decisions.push({ commitmentId, decision });
  }
  return { decisions };
}

export function closeFlowReducer(
  state: CloseFlowState,
  config: CloseFlowConfig,
  action: CloseFlowAction,
): CloseFlowState {
  switch (action.type) {
    case "start":
      return state.step === "results" ? { ...state, step: "decide", index: 0 } : state;
    case "choose":
      return {
        ...state,
        decisions: { ...state.decisions, [action.commitmentId]: action.decision },
        confirmed: withoutKey(state.confirmed, action.commitmentId),
      };
    case "advance":
      if (state.step !== "decide" || isLastHabit(state, config)) return state;
      return { ...state, index: state.index + 1 };
    case "back":
      if (state.step !== "decide") return state;
      if (state.index > 0) return { ...state, sheet: false, index: state.index - 1 };
      return { ...state, sheet: false, step: "results" };
    case "openSheet":
      return { ...state, sheet: true };
    case "confirmGraduate": {
      const id = currentId(state, config);
      if (id === undefined) return { ...state, sheet: false };
      return { ...state, sheet: false, confirmed: { ...state.confirmed, [id]: true } };
    }
    case "dismissSheet": {
      const id = currentId(state, config);
      return {
        ...state,
        sheet: false,
        decisions: id === undefined ? state.decisions : withoutKey(state.decisions, id),
      };
    }
    case "saved":
      return graduatedIds(state, config).length > 0
        ? { ...state, step: "celebrate", celebration: 0, sheet: false }
        : { ...state, step: "summary", sheet: false };
    case "nextCelebration":
      if (state.step !== "celebrate") return state;
      return state.celebration + 1 < graduatedIds(state, config).length
        ? { ...state, celebration: state.celebration + 1 }
        : { ...state, step: "summary" };
  }
}
