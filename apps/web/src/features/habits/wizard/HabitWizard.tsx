import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { CommitmentDto, HabitDto } from "../../../ports/wire.ts";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useSaveWizard, useWizardData } from "../queries.ts";
import { IdentityStep } from "./IdentityStep.tsx";
import { MeasureStep } from "./MeasureStep.tsx";
import { PrivacyStep, wizardSummary } from "./PrivacyStep.tsx";
import { TargetStep } from "./TargetStep.tsx";
import styles from "./Wizard.module.css";
import { initialWizard, prefillWizard, wizardReducer } from "./wizard-model.ts";

/** Both routes share the same editor, but only caller-owned commitments can prefill it. */
export function HabitWizard() {
  const { seasonId, commitmentId } = useParams<{ seasonId: string; commitmentId: string }>();
  const [search] = useSearchParams();
  const habitId = search.get("habitId");
  const navigate = useNavigate();
  const queries = useWizardData(seasonId);
  const [generation, setGeneration] = useState(0);
  const isError = queries.season.isError || queries.habits.isError || queries.circle.isError;
  const isLoading =
    !isError &&
    (queries.season.data === undefined ||
      queries.habits.data === undefined ||
      queries.circle.data === undefined);
  const season = queries.season.data;
  const circle = queries.circle.data?.circle;
  const memberId = circle?.members.find((member) => member.isYou)?.id;
  const commitment = season?.commitments.find(
    (item): item is Extract<CommitmentDto, { kind: "detail" }> =>
      item.id === commitmentId && item.kind === "detail" && item.memberId === memberId,
  );
  const habit = queries.habits.data?.find((item) => item.id === (commitment?.habitId ?? habitId));
  const invalid =
    !seasonId ||
    (!isLoading &&
      (!memberId ||
        !season ||
        season.circleId !== circle?.id ||
        season.status !== "pactOpen" ||
        (commitmentId !== undefined && !commitment) ||
        ((habitId !== null || commitmentId !== undefined) && !habit)));
  if (isError || isLoading || invalid) {
    return (
      <FlowScreen
        title="¿Qué hábito quieres trabajar?"
        backIcon="x"
        backLabel="Cancelar"
        onBack={() => (seasonId ? navigate(`/season/${seasonId}/habits`) : navigate(-1))}
      >
        <div aria-busy={isLoading}>
          {isLoading && !invalid ? (
            <Skeleton shape="card" lines={3} />
          ) : (
            <InlineMessage
              tone="error"
              title="Algo salió mal"
              action={
                <Button
                  variant="ghost"
                  onClick={() => {
                    void queries.season.refetch();
                    void queries.habits.refetch();
                    void queries.circle.refetch();
                  }}
                >
                  Reintentar
                </Button>
              }
            >
              Revisa tu conexión e inténtalo de nuevo.
            </InlineMessage>
          )}
        </div>
      </FlowScreen>
    );
  }
  return (
    <WizardForm
      key={`${seasonId}:${commitmentId ?? habitId ?? "new"}:${generation}`}
      seasonId={seasonId}
      habit={habit}
      commitment={commitment}
      onCreateAnother={() => {
        setGeneration((previous) => previous + 1);
        navigate(`/season/${seasonId}/habits/new`);
      }}
    />
  );
}

function WizardForm({
  seasonId,
  habit,
  commitment,
  onCreateAnother,
}: {
  readonly seasonId: string;
  readonly habit?: HabitDto | undefined;
  readonly commitment?: Extract<CommitmentDto, { kind: "detail" }> | undefined;
  readonly onCreateAnother: () => void;
}) {
  const navigate = useNavigate();
  const [draft, dispatch] = useReducer(
    wizardReducer,
    habit ? prefillWizard(habit, commitment) : initialWizard(),
  );
  const save = useSaveWizard(seasonId, habit);
  const heading = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: step transitions intentionally trigger heading focus, not edits within a step
  useEffect(() => {
    heading.current?.focus();
  }, [draft.step]);
  const measure = draft.measure;
  const title =
    draft.step === 0
      ? "¿Qué hábito quieres trabajar?"
      : draft.step === 1
        ? "¿Cómo lo mides?"
        : draft.step === 2
          ? measure.unit !== "done" && measure.direction === "limit"
            ? "¿Cuánto como máximo?"
            : "¿Cuánto y cada cuánto?"
          : draft.step === 3
            ? "¿Quién lo ve?"
            : "Hábito guardado";
  const frequency =
    measure.unit === "done"
      ? measure.frequency
      : measure.schedule.period === "perSession"
        ? measure.schedule.frequency
        : null;
  const canContinue =
    draft.name.trim().length > 0 &&
    (draft.step !== 1 || measure.unit !== "custom" || Boolean(measure.customLabel?.trim())) &&
    (draft.step !== 2 || frequency?.kind !== "specificDays" || frequency.weekdays.length > 0);
  const submit = async () => {
    if (save.isPending || !canContinue) return;
    if (draft.step < 3) {
      dispatch({ type: "patch", patch: { step: draft.step + 1 } });
      return;
    }
    if (draft.step === 4) {
      if (commitment) navigate(`/season/${seasonId}/habits`);
      else onCreateAnother();
      return;
    }
    try {
      await save.mutateAsync({ draft, commitment });
      dispatch({ type: "patch", patch: { step: 4 } });
    } catch {
      /* The mutation error is rendered without discarding the draft. */
    }
  };
  return (
    <FlowScreen
      title={title}
      headingRef={heading}
      meta={
        draft.step === 4 ? (
          "Listo"
        ) : (
          <>
            <span role="status" aria-live="polite" aria-atomic="true">
              Paso {draft.step + 1} de 4
            </span>
            {draft.step > 0 ? ` · ${draft.name}` : ""}
          </>
        )
      }
      {...(save.isPending
        ? {}
        : {
            onBack: () => {
              void navigate(`/season/${seasonId}/habits`);
            },
          })}
      backLabel={draft.step === 4 ? "Volver" : "Cancelar"}
      backIcon={draft.step === 4 ? "chevron-left" : "x"}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      footer={
        <div className={styles.row}>
          {draft.step > 0 && draft.step < 4 && (
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => dispatch({ type: "patch", patch: { step: draft.step - 1 } })}
            >
              Atrás
            </Button>
          )}
          <Button type="submit" block disabled={save.isPending || !canContinue}>
            {draft.step === 3
              ? "Guardar hábito"
              : draft.step === 4
                ? commitment
                  ? "Listo"
                  : "Crear otro hábito"
                : "Continuar"}
          </Button>
        </div>
      }
    >
      <div className={styles.bars} aria-hidden="true">
        {[0, 1, 2, 3].map((step) => (
          <span key={step} className={styles.bar} data-current={step <= draft.step} />
        ))}
      </div>
      <fieldset className={styles.editor} disabled={save.isPending} aria-busy={save.isPending}>
        {draft.step === 0 && <IdentityStep draft={draft} dispatch={dispatch} />}
        {draft.step === 1 && <MeasureStep draft={draft} dispatch={dispatch} />}
        {draft.step === 2 && <TargetStep draft={draft} dispatch={dispatch} />}
        {draft.step === 3 && <PrivacyStep draft={draft} dispatch={dispatch} />}
        {draft.step === 4 && (
          <div className={styles.stack} role="status">
            <span className={styles.success}>
              <Icon name="circle-check" size="lg" />
            </span>
            <p>{wizardSummary(draft)}</p>
          </div>
        )}
      </fieldset>
      {save.isError && (
        <InlineMessage
          tone="error"
          title="Algo salió mal"
          action={
            <Button variant="ghost" disabled={save.isPending} onClick={() => void submit()}>
              Reintentar
            </Button>
          }
        >
          Revisa tu conexión e inténtalo de nuevo.
        </InlineMessage>
      )}
    </FlowScreen>
  );
}
