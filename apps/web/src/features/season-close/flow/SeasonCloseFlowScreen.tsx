import { useReducer, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useOnline } from "../../../context/connectivity-context.tsx";
import type { SeasonResultsDto } from "../../../ports/wire.ts";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { StepBars } from "../../../ui/StepBars.tsx";
import { type CloseFailure, closeFailure, loadFailure } from "../close-messages.ts";
import { failureCopy, resultsCopy } from "../copy.ts";
import {
  useCanOpenNextSeason,
  useRefetchResults,
  useSeasonCloseOffer,
  useSeasonResults,
  useSubmitClosure,
} from "../queries.ts";
import type { StepChrome } from "../step-chrome.ts";
import { CelebrationStep } from "../steps/CelebrationStep.tsx";
import { DecisionsStep } from "../steps/DecisionsStep.tsx";
import { GraduateSheet } from "../steps/GraduateSheet.tsx";
import { ResultsView } from "../steps/ResultsView.tsx";
import { SummaryStep } from "../steps/SummaryStep.tsx";
import { Unavailable } from "../Unavailable.tsx";
import {
  buildCommand,
  type CloseFlowAction,
  type CloseFlowState,
  closeFlowReducer,
  continueFrom,
  graduatedIds,
  initialCloseState,
  isLastHabit,
  progressBars,
} from "./close-flow.ts";

const TODAY = "/";

interface FlowProps {
  readonly seasonId: string;
  readonly results: SeasonResultsDto;
  /** The closing review's flow, when Today knows it is pending. */
  readonly reviewTarget: string | null;
  readonly onLeave: () => void;
}

/** The steps over one set of results. Everything the member chooses lives here and nowhere else. */
function CloseFlow({ seasonId, results, reviewTarget, onLeave }: FlowProps) {
  const navigate = useNavigate();
  const refetchResults = useRefetchResults(seasonId);
  const online = useOnline();
  const submit = useSubmitClosure(seasonId);
  const config = { commitmentIds: results.commitments.map((c) => c.commitmentId) };
  const [state, dispatch] = useReducer(
    (current: CloseFlowState, action: CloseFlowAction) => closeFlowReducer(current, config, action),
    undefined,
    initialCloseState,
  );
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<CloseFailure | null>(null);
  const [closedNow, setClosedNow] = useState(false);
  const canPrepare = useCanOpenNextSeason(closedNow);

  const toReview = () => void navigate(reviewTarget ?? TODAY, { replace: true });
  if (blocked !== null) {
    return (
      <Unavailable
        message={blocked.message}
        {...(blocked.kind === "reviewRequired" ? { onReview: toReview } : {})}
        onLeave={onLeave}
      />
    );
  }

  const stored = results.closure;
  // A closure that is already stored (a second visit, or a lost race) is shown as saved, read-only.
  const step =
    stored !== null && (state.step === "results" || state.step === "decide")
      ? "summary"
      : state.step;

  const save = async () => {
    const command = buildCommand(state, config);
    if (command === null) return;
    setError(null);
    try {
      const saved = await submit.mutateAsync(command);
      setClosedNow(saved.seasonClosed);
      dispatch({ type: "saved" });
    } catch (cause) {
      const failure = closeFailure(cause);
      if (failure.kind === "alreadySubmitted") {
        await refetchResults();
        return;
      }
      if (failure.kind === "retry" || failure.kind === "generic" || failure.kind === "incomplete") {
        setError(failure.message);
        return;
      }
      setBlocked(failure);
    }
  };

  const names = new Map(results.commitments.map((c) => [c.commitmentId, c]));

  if (step === "results") {
    const reviewPending = !results.closingReviewDone;
    return (
      <ResultsView
        results={results}
        onBack={onLeave}
        footer={
          reviewPending ? (
            <Button block onClick={toReview}>
              {resultsCopy.review}
            </Button>
          ) : (
            <Button block onClick={() => dispatch({ type: "start" })}>
              {resultsCopy.decide}
            </Button>
          )
        }
      />
    );
  }

  if (step === "celebrate") {
    const ids = graduatedIds(state, config);
    const id = ids[state.celebration];
    const row = id === undefined ? undefined : names.get(id);
    if (row === undefined) return <Navigate to={TODAY} replace />;
    return (
      <CelebrationStep
        habitName={row.habitName}
        weeks={results.lengthWeeks}
        consistencyPercent={row.consistencyPercent}
        hasNext={state.celebration + 1 < ids.length}
        onNext={() => dispatch({ type: "nextCelebration" })}
      />
    );
  }

  if (step === "summary") {
    const decisions =
      state.step === "summary"
        ? config.commitmentIds.map((commitmentId) => ({
            commitmentId,
            decision: state.decisions[commitmentId],
          }))
        : (stored?.decisions ?? []);
    const rows = decisions.flatMap(({ commitmentId, decision }) => {
      const row = names.get(commitmentId);
      return row === undefined || decision === undefined
        ? []
        : [{ commitmentId, habitName: row.habitName, decision }];
    });
    return (
      <SummaryStep
        rows={rows}
        canPrepare={canPrepare}
        onPrepare={() => void navigate("/season/new")}
        onToday={() => void navigate(TODAY, { replace: true })}
      />
    );
  }

  const current = results.commitments[state.index];
  if (current === undefined) return <Navigate to={TODAY} replace />;
  const bars = progressBars(state, config);
  const chrome: StepChrome = {
    onBack: () => dispatch({ type: "back" }),
    backLabel: resultsCopy.back,
    backIcon: "chevron-left",
    progress: <StepBars current={bars.current} total={bars.total} />,
  };
  const last = isLastHabit(state, config);
  const onContinue = () => {
    switch (continueFrom(state, config)) {
      case "confirm":
        dispatch({ type: "openSheet" });
        return;
      case "save":
        void save();
        return;
      case "next":
        dispatch({ type: "advance" });
        return;
      case "blocked":
        return;
    }
  };
  return (
    <>
      <DecisionsStep
        chrome={chrome}
        commitment={current}
        position={{ index: state.index, total: config.commitmentIds.length }}
        decision={state.decisions[current.commitmentId]}
        onChoose={(decision) => {
          setError(null);
          dispatch({ type: "choose", commitmentId: current.commitmentId, decision });
        }}
        onContinue={onContinue}
        last={last}
        pending={submit.isPending}
        offline={!online}
        error={error}
      />
      <GraduateSheet
        open={state.sheet}
        habitName={current.habitName}
        pending={submit.isPending}
        offline={last && !online}
        onCancel={() => dispatch({ type: "dismissSheet" })}
        onConfirm={() => {
          dispatch({ type: "confirmGraduate" });
          if (last) void save();
          else dispatch({ type: "advance" });
        }}
      />
    </>
  );
}

function Loading({ onClose }: { readonly onClose: () => void }) {
  return (
    <FlowScreen title={resultsCopy.screenTitle} onBack={onClose}>
      <div role="status" aria-label="Cargando tus resultados" aria-busy="true">
        <Skeleton shape="line" lines={4} />
      </div>
    </FlowScreen>
  );
}

/**
 * The full-screen close of the season (36, 37, 37b, 38a, 38b), outside the tab bar. It decides only
 * whether the results can be shown; the steps and the draft belong to {@link CloseFlow}.
 */
export function SeasonCloseFlowScreen() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const navigate = useNavigate();
  if (seasonId === undefined) return <Navigate to={TODAY} replace />;
  return <CloseGate seasonId={seasonId} onLeave={() => void navigate(TODAY, { replace: true })} />;
}

function CloseGate({
  seasonId,
  onLeave,
}: {
  readonly seasonId: string;
  readonly onLeave: () => void;
}) {
  const query = useSeasonResults(seasonId);
  const offer = useSeasonCloseOffer();
  const pending = offer?.pendingReview;
  const reviewTarget =
    pending?.kind === "closing" ? `/review/${pending.seasonId}/${pending.periodIndex}` : null;
  if (query.isPending) return <Loading onClose={onLeave} />;
  if (query.isError) {
    const failure = loadFailure(query.error);
    return (
      <Unavailable
        message={failure.message}
        {...(failure.retryable ? { onRetry: () => void query.refetch() } : {})}
        onLeave={onLeave}
      />
    );
  }
  if (query.data.commitments.length === 0) {
    return <Unavailable message={failureCopy.nothing} onLeave={onLeave} />;
  }
  return (
    <CloseFlow
      seasonId={seasonId}
      results={query.data}
      reviewTarget={reviewTarget}
      onLeave={onLeave}
    />
  );
}
