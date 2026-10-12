import type { MeasureView } from "@pactjoy/app";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import type { CarryOverItemDto, CommitmentDto, Serialized } from "../../../ports/wire.ts";
import { weekdayDay } from "../../../shared/format.ts";
import { scheduleText, targetText } from "../../../shared/row-labels.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { cx } from "../../../ui/cx.ts";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { measureFromView } from "../../habits/index.ts";
import { viewerMemberId } from "../pact-flow.ts";
import {
  useAddCommitment,
  useCarryOver,
  useCurrentCircle,
  useHabits,
  useRemoveCommitment,
  useSeason,
} from "../queries.ts";
import styles from "./ChooseHabitsScreen.module.css";

/** Subtitle for an existing season commitment based on its schedule and target thresholds. */
export function commitmentSubtitle(measure: Serialized<MeasureView> | MeasureView): string {
  const mv = measure as MeasureView;
  const sched = scheduleText(mv);
  if (mv.unit === "done") {
    if (mv.schedule.frequency.kind === "specificDays") {
      return sched;
    }
    return sched ? `${sched} · hecho / no hecho` : "hecho / no hecho";
  }
  const target = targetText(mv);
  return target ? `${sched} · ${target}` : sched;
}

/** Design screen 10 counter recommendation copy. */
export function chosenCommitmentsMessage(count: number): string {
  const noun = count === 1 ? "1 compromiso elegido." : `${count} compromisos elegidos.`;
  return `${noun} Sugerimos entre 2 y 5.`;
}

/**
 * Design 10: Elegir hábitos para esta temporada.
 * Allows any member to select which of their habits are part of the season.
 * Checked rows represent existing commitments; unchecked rows represent available habits.
 */
export function ChooseHabitsScreen() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const navigate = useNavigate();
  const circleQuery = useCurrentCircle();
  const seasonQuery = useSeason(seasonId);
  const habitsQuery = useHabits();
  const removeCommitment = useRemoveCommitment();
  const addCommitment = useAddCommitment();
  const [failure, setFailure] = useState<string | undefined>();

  const isLoadError = circleQuery.isError || seasonQuery.isError || habitsQuery.isError;
  const isLoading =
    !isLoadError &&
    (circleQuery.isLoading ||
      seasonQuery.isLoading ||
      habitsQuery.isLoading ||
      circleQuery.data === undefined ||
      seasonQuery.data === undefined ||
      habitsQuery.data === undefined);

  const circle = circleQuery.data?.circle;
  const myMemberId = viewerMemberId(circleQuery.data ?? { circle: null });
  const season = seasonQuery.data;
  // A graduated habit is gone for good: it is never offered again.
  const habits = (habitsQuery.data ?? []).filter((h) => h.graduatedAt === null);
  const carryOver = useCarryOver(seasonId, season?.status === "pactOpen");

  if (!isLoadError && season && season.status !== "pactOpen") {
    return <Navigate to={`/season/${season.id}/pact`} replace />;
  }

  const mySeasonCommitments =
    season?.commitments.filter(
      (c): c is Extract<CommitmentDto, { kind: "detail" }> =>
        c.kind === "detail" && c.memberId === myMemberId,
    ) ?? [];

  const assignedHabitIds = new Set(mySeasonCommitments.map((c) => c.habitId));
  const habitById = new Map(habits.map((h) => [h.id, h]));
  // "Continuar" and "Ajustar" are offered, never applied; "Pausar" stays a normal row with a hint.
  const offered = (carryOver.data?.items ?? []).filter(
    (item) =>
      item.decision !== "pause" &&
      habitById.has(item.habitId) &&
      !assignedHabitIds.has(item.habitId),
  );
  const offeredHabitIds = new Set(offered.map((item) => item.habitId));
  const pausedHabitIds = new Set(
    (carryOver.data?.items ?? []).filter((i) => i.decision === "pause").map((i) => i.habitId),
  );
  const unassignedHabits = habits.filter(
    (h) => !assignedHabitIds.has(h.id) && !offeredHabitIds.has(h.id),
  );

  const metaText = season
    ? `Temporada de ${season.lengthWeeks} semanas · empieza el ${weekdayDay(season.nominalStart).toLowerCase()}`
    : (circle?.name ?? "Temporada");

  const onUncheckCommitment = async (commitmentId: string) => {
    if (!seasonId) return;
    try {
      setFailure(undefined);
      await removeCommitment.mutateAsync({ seasonId, commitmentId });
    } catch {
      setFailure("No pudimos quitar el compromiso. Inténtalo de nuevo.");
    }
  };

  const onCheckHabit = (habitId: string) => {
    if (!seasonId) return;
    navigate(`/season/${seasonId}/habits/new?habitId=${habitId}`);
  };

  const onContinueSame = async (item: CarryOverItemDto) => {
    if (!seasonId) return;
    try {
      setFailure(undefined);
      await addCommitment.mutateAsync({
        seasonId,
        input: {
          habitId: item.habitId,
          weightPercent: item.previous.weightPercent,
          privacy: item.previous.privacy,
          measure: measureFromView(item.previous.measure),
        },
      });
    } catch {
      setFailure("No pudimos agregar el compromiso. Inténtalo de nuevo.");
    }
  };

  const onAdjust = (item: CarryOverItemDto) => {
    if (!seasonId) return;
    navigate(`/season/${seasonId}/habits/new?habitId=${item.habitId}`, {
      state: { prefill: item.previous },
    });
  };

  const onCreateHabit = () => {
    if (!seasonId) return;
    navigate(`/season/${seasonId}/habits/new`);
  };

  const onRetryLoad = () => {
    void circleQuery.refetch();
    void seasonQuery.refetch();
    void habitsQuery.refetch();
  };

  const hasItems = mySeasonCommitments.length > 0 || unassignedHabits.length > 0;
  const busy = removeCommitment.isPending || addCommitment.isPending;

  return (
    <FlowScreen
      title="¿Qué vas a trabajar esta temporada?"
      meta={metaText}
      onBack={() => navigate(-1)}
      footer={
        <Button
          type="button"
          block
          disabled={
            isLoading || isLoadError || busy || mySeasonCommitments.length === 0 || !seasonId
          }
          onClick={() => {
            if (seasonId) navigate(`/season/${seasonId}/weights`);
          }}
        >
          Repartir pesos
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
            {offered.length > 0 && (
              <section className={styles.carryOver} aria-labelledby="carry-over-title">
                <h2 id="carry-over-title" className={styles.carryOverTitle}>
                  De tu temporada anterior
                </h2>
                <Card>
                  <ul className={styles.habitList}>
                    {offered.map((item) => {
                      const habit = habitById.get(item.habitId);
                      const nameId = `carry-name-${item.habitId}`;
                      const subtitle = commitmentSubtitle(item.previous.measure);
                      return (
                        <li key={item.habitId} className={styles.carryRow} aria-labelledby={nameId}>
                          <div className={styles.habitInfo}>
                            <div id={nameId} className={styles.habitName}>
                              {habit?.name}
                            </div>
                            {subtitle && <div className={styles.habitSubtitle}>{subtitle}</div>}
                          </div>
                          {item.decision === "continue" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void onContinueSame(item)}
                            >
                              Seguir igual
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => onAdjust(item)}
                            >
                              Ajustar
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            )}

            {hasItems && (
              <Card>
                <div className={styles.habitList}>
                  {mySeasonCommitments.map((c) => {
                    if (c.kind !== "detail") return null;
                    const habitName =
                      c.habit?.name ?? habits.find((h) => h.id === c.habitId)?.name ?? "Hábito";
                    const subtitle = commitmentSubtitle(c.measure);
                    const nameId = `commitment-name-${c.id}`;
                    const subtitleId = `commitment-sub-${c.id}`;
                    const isPending = busy;
                    return (
                      <label
                        key={c.id}
                        className={cx(styles.habitRow, isPending && styles.habitRowDisabled)}
                      >
                        <div className={styles.habitInfo}>
                          <div id={nameId} className={styles.habitName}>
                            {habitName}
                          </div>
                          {subtitle && (
                            <div id={subtitleId} className={styles.habitSubtitle}>
                              {subtitle}
                            </div>
                          )}
                        </div>
                        <div className={styles.checkWrap}>
                          <input
                            type="checkbox"
                            checked={true}
                            disabled={isPending}
                            onChange={() => onUncheckCommitment(c.id)}
                            className={styles.checkboxInput}
                            aria-labelledby={nameId}
                            aria-describedby={subtitle ? subtitleId : undefined}
                          />
                          <span className={styles.checkBox} aria-hidden="true">
                            <Icon name="check" size="sm" />
                          </span>
                        </div>
                      </label>
                    );
                  })}
                  {unassignedHabits.map((h) => {
                    const nameId = `habit-name-${h.id}`;
                    const hintId = `habit-hint-${h.id}`;
                    const pausedId = `habit-paused-${h.id}`;
                    return (
                      <label
                        key={h.id}
                        className={cx(styles.habitRow, busy && styles.habitRowDisabled)}
                      >
                        <div className={styles.habitInfo}>
                          <div id={nameId} className={styles.habitName}>
                            {h.name}
                          </div>
                          {pausedHabitIds.has(h.id) && (
                            <div id={pausedId} className={styles.habitSubtitle}>
                              La dejaste en pausa
                            </div>
                          )}
                        </div>
                        <div className={styles.checkWrap}>
                          <input
                            type="checkbox"
                            checked={false}
                            disabled={busy}
                            onChange={() => onCheckHabit(h.id)}
                            className={styles.checkboxInput}
                            aria-labelledby={nameId}
                            aria-describedby={
                              pausedHabitIds.has(h.id) ? `${hintId} ${pausedId}` : hintId
                            }
                          />
                          <span className={styles.checkBox} aria-hidden="true" />
                        </div>
                        <span id={hintId} className={styles.visuallyHidden}>
                          Configurar compromiso para esta temporada
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Card>
            )}

            <Button variant="secondary" block leadingIcon="plus" onClick={onCreateHabit}>
              Crear hábito
            </Button>

            <div className={styles.counterHint}>
              {chosenCommitmentsMessage(mySeasonCommitments.length)}
            </div>

            {failure !== undefined && <InlineMessage tone="error" title={failure} />}
          </>
        )}
      </div>
    </FlowScreen>
  );
}
