import { Navigate, useNavigate, useParams } from "react-router";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { loadFailure } from "../close-messages.ts";
import { resultsCopy } from "../copy.ts";
import { useSeasonResults } from "../queries.ts";
import { ResultsView } from "../steps/ResultsView.tsx";
import { Unavailable } from "../Unavailable.tsx";

const TODAY = "/";
/** The history lives in Perfil (design 39), so that is where Volver returns. */
const PROFILE = "/profile";

/** `/season/:seasonId/results`: screen 36 read-only, for a closed season in the Perfil history. */
export function SeasonResultsScreen() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const navigate = useNavigate();
  if (seasonId === undefined) return <Navigate to={TODAY} replace />;
  return <ResultsGate seasonId={seasonId} onBack={() => void navigate(PROFILE)} />;
}

function ResultsGate({
  seasonId,
  onBack,
}: {
  readonly seasonId: string;
  readonly onBack: () => void;
}) {
  const navigate = useNavigate();
  const query = useSeasonResults(seasonId);
  if (query.isPending) {
    return (
      <FlowScreen title={resultsCopy.screenTitle} onBack={onBack}>
        <div role="status" aria-label="Cargando tus resultados" aria-busy="true">
          <Skeleton shape="line" lines={4} />
        </div>
      </FlowScreen>
    );
  }
  if (query.isError) {
    const failure = loadFailure(query.error);
    return (
      <Unavailable
        message={failure.message}
        {...(failure.retryable ? { onRetry: () => void query.refetch() } : {})}
        onLeave={() => void navigate(TODAY, { replace: true })}
      />
    );
  }
  return <ResultsView results={query.data} onBack={onBack} />;
}
