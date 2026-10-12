import { useReducer, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useOnline } from "../../../context/connectivity-context.tsx";
import type { ReviewDraftDto, SubmittedReviewDto } from "../../../ports/wire.ts";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { StepBars } from "../../../ui/StepBars.tsx";
import type { StepChrome } from "../chrome.ts";
import { ReviewDoneStep } from "../done/ReviewDoneStep.tsx";
import { useReview, useSubmitReview } from "../queries.ts";
import { ReflectionStep } from "../reflection/ReflectionStep.tsx";
import { loadFailure, type ReviewFailure, reviewFailure } from "../review-messages.ts";
import { FullSrbaiStep } from "../srbai/FullSrbaiStep.tsx";
import { ItemOneStep } from "../srbai/ItemOneStep.tsx";
import { PeriodSummaryStep } from "../summary/PeriodSummaryStep.tsx";
import { ReviewUnavailable } from "./ReviewUnavailable.tsx";
import {
  buildSubmission,
  type FlowConfig,
  initialFlowState,
  isFirstScreen,
  isLastCommitment,
  progressBars,
  reviewFlowReducer,
} from "./review-flow.ts";

const TODAY = "/";

/** `/review/:seasonId/:periodIndex`: a whole number, 0 for the baseline. Anything else is no review. */
const parsePeriod = (raw: string | undefined): number | null =>
  raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;

type Result = Pick<SubmittedReviewDto, "improvements" | "nextReviewDate">;

interface FlowProps {
  readonly seasonId: string;
  readonly periodIndex: number;
  readonly draft: ReviewDraftDto;
}

/** The steps over one due draft. Everything the member types lives here and nowhere else. */
function ReviewFlow({ seasonId, periodIndex, draft }: FlowProps) {
  const navigate = useNavigate();
  const online = useOnline();
  const submit = useSubmitReview(seasonId, periodIndex);
  const config: FlowConfig = {
    kind: draft.kind,
    srbai: draft.srbai,
    commitmentIds: draft.commitments.map((c) => c.commitmentId),
  };
  const [state, dispatch] = useReducer(
    (
      current: ReturnType<typeof initialFlowState>,
      action: Parameters<typeof reviewFlowReducer>[2],
    ) => reviewFlowReducer(current, config, action),
    config,
    initialFlowState,
  );
  const [result, setResult] = useState<Result | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reflectionErrors, setReflectionErrors] = useState<{
    helped: string | null;
    hard: string | null;
  }>({ helped: null, hard: null });
  const [blocked, setBlocked] = useState<ReviewFailure | null>(null);

  const leave = () => void navigate(TODAY, { replace: true });
  const names = new Map(draft.commitments.map((c) => [c.commitmentId, c.habitName]));

  if (blocked !== null) {
    return <ReviewUnavailable message={blocked.message} onLeave={leave} />;
  }
  if (state.step === "done") {
    return <ReviewDoneStep result={result} names={names} onFinish={leave} />;
  }

  const first = isFirstScreen(state);
  const bars = progressBars(state, config);
  const chrome: StepChrome = {
    onBack: first ? leave : () => dispatch({ type: "back" }),
    // The first screen closes the flow and discards the draft: the review stays due (REQ-S5).
    backLabel: first && state.step === "summary" ? "Cerrar" : "Volver",
    backIcon: first && state.step === "summary" ? "x" : "chevron-left",
    progress: <StepBars current={bars.current} total={bars.total} />,
  };

  const save = async () => {
    setSaveError(null);
    setReflectionErrors({ helped: null, hard: null });
    try {
      const saved = await submit.mutateAsync(buildSubmission(state, config));
      setResult({ improvements: saved.improvements, nextReviewDate: saved.nextReviewDate });
      dispatch({ type: "done" });
    } catch (error) {
      const failure = reviewFailure(error);
      switch (failure.kind) {
        case "alreadySubmitted":
          setResult(null);
          dispatch({ type: "done" });
          return;
        case "reflection":
          setReflectionErrors({
            helped: failure.field === "hard" ? null : failure.message,
            hard: failure.field === "hard" ? failure.message : null,
          });
          dispatch({ type: "show", step: "reflection" });
          return;
        case "notDue":
        case "lapsed":
        case "notFound":
          setBlocked(failure);
          return;
        default:
          setSaveError(failure.message);
          if (failure.kind === "answers") dispatch({ type: "show", step: "srbai" });
      }
    }
  };

  if (state.step === "summary") {
    return (
      <PeriodSummaryStep chrome={chrome} draft={draft} onNext={() => dispatch({ type: "next" })} />
    );
  }
  if (state.step === "reflection") {
    return (
      <ReflectionStep
        chrome={chrome}
        helped={state.helped}
        hard={state.hard}
        errors={reflectionErrors}
        onChange={(field, value) => {
          setReflectionErrors((current) => ({ ...current, [field]: null }));
          dispatch({ type: "reflect", field, value });
        }}
        onSkip={() => dispatch({ type: "skipReflection" })}
        onNext={() => dispatch({ type: "next" })}
      />
    );
  }

  if (config.srbai === "item1") {
    return (
      <ItemOneStep
        chrome={chrome}
        commitments={draft.commitments}
        answers={state.answers}
        onAnswer={(commitmentId, score) =>
          dispatch({ type: "answer", commitmentId, item: 0, score })
        }
        onFinish={() => void save()}
        pending={submit.isPending}
        offline={!online}
        error={saveError}
      />
    );
  }
  const current = draft.commitments[state.index];
  if (current === undefined)
    return <ReviewUnavailable message="No encontramos esta revisión." onLeave={leave} />;
  const last = isLastCommitment(state, config);
  return (
    <FullSrbaiStep
      chrome={chrome}
      habitName={current.habitName}
      paused={current.paused}
      position={{ index: state.index, total: draft.commitments.length }}
      nextName={last ? null : (draft.commitments[state.index + 1]?.habitName ?? null)}
      slots={state.answers[current.commitmentId] ?? [null, null, null, null]}
      onAnswer={(item, score) =>
        dispatch({ type: "answer", commitmentId: current.commitmentId, item, score })
      }
      onNext={() => (last ? void save() : dispatch({ type: "next" }))}
      pending={submit.isPending}
      offline={!online}
      error={saveError}
    />
  );
}

function Loading({ onClose }: { readonly onClose: () => void }) {
  return (
    <FlowScreen title="Tu revisión" onBack={onClose} backLabel="Cerrar" backIcon="x">
      <div aria-busy="true">
        <Skeleton shape="line" lines={4} />
      </div>
    </FlowScreen>
  );
}

/**
 * The full-screen review (33 to 35c, and 13 for the baseline), outside the tab bar. It decides
 * only whether the period can be answered; the steps and the draft belong to {@link ReviewFlow}.
 * The closing review has no screen in this change: it goes back to Today.
 */
export function ReviewFlowScreen() {
  const { seasonId, periodIndex: rawPeriod } = useParams<{
    seasonId: string;
    periodIndex: string;
  }>();
  const navigate = useNavigate();
  const period = parsePeriod(rawPeriod);
  const leave = () => void navigate(TODAY, { replace: true });
  if (seasonId === undefined || period === null) return <Navigate to={TODAY} replace />;
  return <ReviewGate seasonId={seasonId} periodIndex={period} onLeave={leave} />;
}

interface GateProps {
  readonly seasonId: string;
  readonly periodIndex: number;
  readonly onLeave: () => void;
}

function ReviewGate({ seasonId, periodIndex, onLeave }: GateProps) {
  const query = useReview(seasonId, periodIndex);
  if (query.isPending) return <Loading onClose={onLeave} />;
  if (query.isError) {
    const failure = loadFailure(query.error);
    return (
      <ReviewUnavailable
        message={failure.message}
        {...(failure.retryable ? { onRetry: () => void query.refetch() } : {})}
        onLeave={onLeave}
      />
    );
  }
  const draft = query.data;
  if (draft.kind === "closing") return <Navigate to={TODAY} replace />;
  if (draft.status === "upcoming") {
    return (
      <ReviewUnavailable message="Esta revisión todavía no está disponible." onLeave={onLeave} />
    );
  }
  if (draft.status === "lapsed") {
    return (
      <ReviewUnavailable
        message="Esta revisión ya pasó. La próxima te llegará a su hora."
        onLeave={onLeave}
      />
    );
  }
  if (draft.status === "completed" || draft.status === "skipped") {
    return <ReviewDoneStep result={null} names={new Map()} onFinish={onLeave} />;
  }
  if (draft.commitments.length === 0) {
    return <ReviewUnavailable message="No encontramos esta revisión." onLeave={onLeave} />;
  }
  return <ReviewFlow seasonId={seasonId} periodIndex={periodIndex} draft={draft} />;
}
