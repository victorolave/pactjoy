import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { CommitmentDto } from "../../../ports/wire.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { viewerMemberId } from "../pact-flow.ts";
import { useCurrentCircle, useEditCommitment, useSeason } from "../queries.ts";
import styles from "./WeightsScreen.module.css";
import { changeWeight, equalWeights, measureViewToInput, weightSummary } from "./weights-model.ts";

/**
 * Design 11a: Distribuir pesos.
 * Allows members to distribute weights among their season commitments in 5% steps.
 * Total must equal 100% to proceed to pact review.
 */
export function WeightsScreen() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const navigate = useNavigate();
  const circleQuery = useCurrentCircle();
  const seasonQuery = useSeason(seasonId);
  const editCommitment = useEditCommitment();

  const [weights, setWeights] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  const isLoadError = circleQuery.isError || seasonQuery.isError;
  const isLoading =
    !isLoadError &&
    (circleQuery.isLoading ||
      seasonQuery.isLoading ||
      circleQuery.data === undefined ||
      seasonQuery.data === undefined);
  const isMutating = isSaving || editCommitment.isPending;

  const myMemberId = viewerMemberId(circleQuery.data ?? { circle: null });
  const season = seasonQuery.data;

  const myCommitments =
    season?.commitments.filter(
      (c): c is Extract<CommitmentDto, { kind: "detail" }> =>
        c.kind === "detail" && c.memberId === myMemberId,
    ) ?? [];

  const currentWeights = myCommitments.map((c) => weights[c.id] ?? c.weightPercent);
  const summary = weightSummary(currentWeights);

  const handleStep = (commitmentId: string, step: -5 | 5) => {
    if (isMutating) return;
    const current =
      weights[commitmentId] ?? myCommitments.find((c) => c.id === commitmentId)?.weightPercent ?? 5;
    try {
      const next = changeWeight(current, step);
      setWeights((prev) => ({ ...prev, [commitmentId]: next }));
    } catch {
      // Step ignored if invalid
    }
  };

  const handleEqualize = () => {
    if (isMutating) return;
    const eq = equalWeights(myCommitments.length);
    if (!eq) return;
    const next: Record<string, number> = {};
    myCommitments.forEach((c, index) => {
      const val = eq[index];
      if (val !== undefined) next[c.id] = val;
    });
    setWeights(next);
  };

  const handleContinue = async () => {
    if (!summary.canContinue || isMutating || !seasonId) return;
    setIsSaving(true);
    setFailure(undefined);

    const changed = myCommitments.filter(
      (c) => (weights[c.id] ?? c.weightPercent) !== c.weightPercent,
    );

    try {
      if (changed.length > 0) {
        await Promise.all(
          changed.map((c) =>
            editCommitment.mutateAsync({
              seasonId,
              commitmentId: c.id,
              input: {
                weightPercent: weights[c.id] ?? c.weightPercent,
                privacy: c.privacy,
                measure: measureViewToInput(c.measure),
              },
            }),
          ),
        );
      }
      navigate(`/season/${seasonId}/pact`);
    } catch {
      setFailure("No pudimos guardar los pesos. Inténtalo de nuevo.");
    } finally {
      setIsSaving(false);
    }
  };

  const onRetryLoad = () => {
    void circleQuery.refetch();
    void seasonQuery.refetch();
  };

  const ctaText = summary.canContinue ? "Revisar el pacto" : "La suma debe ser 100 %";

  return (
    <FlowScreen
      title="¿Cuánto pesa cada uno?"
      meta="Tienes 1.000 puntos posibles"
      onBack={() => {
        if (!isMutating) navigate(-1);
      }}
      footer={
        <Button
          type="button"
          block
          disabled={isLoading || isLoadError || isMutating || !summary.canContinue || !seasonId}
          onClick={handleContinue}
        >
          {ctaText}
        </Button>
      }
    >
      <div className={styles.section} aria-busy={isLoading ? "true" : undefined}>
        {isLoadError ? (
          <InlineMessage
            tone="error"
            title={circleQuery.isError ? "No pudimos cargar tu círculo." : "Algo salió mal"}
            action={
              <Button variant="ghost" size="sm" onClick={onRetryLoad}>
                Reintentar
              </Button>
            }
          >
            Revisa tu conexión e inténtalo de nuevo.
          </InlineMessage>
        ) : isLoading ? (
          <Skeleton shape="card" lines={3} />
        ) : (
          <>
            {myCommitments.length > 0 && (
              <Card>
                <div className={styles.weightsList}>
                  {myCommitments.map((c) => {
                    if (c.kind !== "detail") return null;
                    const habitName = c.habit?.name ?? "Hábito";
                    const weight = weights[c.id] ?? c.weightPercent;
                    const points = weight * 10;
                    const pointsLabel =
                      points === 1000 ? "1.000 pts posibles" : `${points} pts posibles`;
                    return (
                      <div key={c.id} className={styles.weightRow}>
                        <div className={styles.habitInfo}>
                          <div className={styles.habitName}>{habitName}</div>
                          <div className={styles.pointsSubtitle}>{pointsLabel}</div>
                        </div>
                        <button
                          type="button"
                          aria-label="Restar 5 %"
                          disabled={isMutating || weight <= 5}
                          className={styles.stepButton}
                          onClick={() => handleStep(c.id, -5)}
                        >
                          <Icon name="minus" size="sm" />
                        </button>
                        <span className={styles.weightValue}>{weight} %</span>
                        <button
                          type="button"
                          aria-label="Sumar 5 %"
                          disabled={isMutating || weight >= 100}
                          className={styles.stepButton}
                          onClick={() => handleStep(c.id, 5)}
                        >
                          <Icon name="plus" size="sm" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <div className={styles.summarySection}>
              <div className={styles.summaryHead}>
                <span className={styles.summaryLabel}>Suma {summary.total} %</span>
                <span className={styles.summaryMessage} data-tone={summary.tone}>
                  {summary.message}
                </span>
              </div>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-valuenow={summary.total}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Suma de pesos"
              >
                <div
                  className={styles.progressFill}
                  data-tone={summary.tone}
                  style={{ width: `${Math.min(100, summary.total)}%` }}
                />
              </div>
            </div>

            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={isMutating || myCommitments.length === 0}
                onClick={handleEqualize}
              >
                Repartir por igual
              </Button>
            </div>

            <div className={styles.hint}>
              Más peso = más puntos en juego. No cambia lo que tienes que hacer.
            </div>

            {failure !== undefined && <InlineMessage tone="error" title={failure} />}
          </>
        )}
      </div>
    </FlowScreen>
  );
}
