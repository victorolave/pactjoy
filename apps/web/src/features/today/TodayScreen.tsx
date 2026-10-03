import { toUiError } from "../../shared/ui-error.ts";
import { Button } from "../../ui/Button.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { useToday } from "./queries.ts";
import styles from "./TodayScreen.module.css";
import { NoCircle, NoSeason, NotStarted, PactOpen, RunningHeader } from "./TodayStates.tsx";
import { type TodayModel, toTodayModel } from "./today-view-model.ts";

function TodayContent({ model }: { readonly model: TodayModel }) {
  switch (model.kind) {
    case "noCircle":
      return <NoCircle />;
    case "noSeason":
      return <NoSeason circleName={model.circleName} />;
    case "pactOpen":
      return <PactOpen model={model} />;
    case "notStarted":
      return <NotStarted model={model} />;
    case "active":
    case "ended":
      return <RunningHeader model={model} />;
  }
}

function TodayLoading() {
  return (
    <div className={styles.screen} role="status" aria-busy="true" aria-label="Cargando Hoy">
      <Skeleton shape="line" lines={2} />
      <Skeleton shape="card" lines={3} />
    </div>
  );
}

function TodayFailure({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const { retryable } = toUiError(error);
  return (
    <InlineMessage
      tone="error"
      title={retryable ? "No pudimos cargar Hoy" : "Algo salió mal"}
      action={
        retryable ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Reintentar
          </Button>
        ) : undefined
      }
    >
      {retryable ? "Revisa tu conexión e inténtalo de nuevo." : "Inténtalo de nuevo más tarde."}
    </InlineMessage>
  );
}

export function TodayScreen() {
  const today = useToday();
  if (today.isPending) return <TodayLoading />;
  if (today.isError)
    return <TodayFailure error={today.error} onRetry={() => void today.refetch()} />;
  return (
    <div className={styles.screen}>
      <TodayContent model={toTodayModel(today.data)} />
    </div>
  );
}
