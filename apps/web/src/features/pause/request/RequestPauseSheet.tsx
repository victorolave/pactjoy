import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { useToasts } from "../../../context/toast-context.tsx";
import type { PauseReasonCode } from "../../../ports/pactjoy-api.ts";
import { addDays, daysBetween } from "../../../shared/date.ts";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { SegmentedControl } from "../../../ui/SegmentedControl.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { Tag } from "../../../ui/Tag.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { type PausableCommitment, type PauseSeason, usePauseContext } from "../pause-context.ts";
import { commitmentList, PAUSE_REASON_OPTIONS } from "../pause-format.ts";
import { type PauseFailure, pauseFailure } from "../pause-messages.ts";
import { useRequestPause } from "../queries.ts";
import styles from "./RequestPauseSheet.module.css";

const ALL = "all";
const MAX_NOTE_LENGTH = 280;

export interface RequestPauseSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The Commitment to preselect (opened from its screen, PS-1). Todos when absent. */
  readonly initialCommitmentId?: string;
  /** A first day to prefill, as "Pedir más días" does (PS-13). */
  readonly initialStart?: string;
}

const daysText = (days: number) => `${days} ${days === 1 ? "día" : "días"}`;

function nameOf(commitments: readonly PausableCommitment[], id: string): string {
  return commitments.find((c) => c.id === id)?.habitName ?? id;
}

function FailureDetails({
  failure,
  commitments,
}: {
  readonly failure: PauseFailure;
  readonly commitments: readonly PausableCommitment[];
}) {
  return (
    <InlineMessage tone="error" title={failure.message}>
      {failure.capExceeded.length > 0 && (
        <ul className={styles.list}>
          {failure.capExceeded.map((item) => (
            <li key={item.commitmentId}>
              {item.remainingDays === 0
                ? `${nameOf(commitments, item.commitmentId)}: no te quedan días`
                : `${nameOf(commitments, item.commitmentId)}: te quedan ${daysText(item.remainingDays)}`}
            </li>
          ))}
        </ul>
      )}
      {failure.overlapping.length > 0 && (
        <ul className={styles.list}>
          {failure.overlapping.map((id) => (
            <li key={id}>{nameOf(commitments, id)}</li>
          ))}
        </ul>
      )}
    </InlineMessage>
  );
}

function Form({
  season,
  approverNames,
  remainingDays,
  budgetsKnown,
  initialCommitmentId,
  initialStart,
  onClose,
}: {
  readonly season: PauseSeason;
  readonly approverNames: readonly string[];
  readonly remainingDays: ReadonlyMap<string, number>;
  readonly budgetsKnown: boolean;
  readonly initialCommitmentId: string | undefined;
  readonly initialStart: string | undefined;
  readonly onClose: () => void;
}) {
  const online = useOnline();
  const toasts = useToasts();
  const request = useRequestPause(season.seasonId);
  const { commitments } = season;
  const offersAll = commitments.length > 1;

  const [scope, setScope] = useState<string>(
    initialCommitmentId !== undefined && commitments.some((c) => c.id === initialCommitmentId)
      ? initialCommitmentId
      : offersAll
        ? ALL
        : (commitments[0]?.id ?? ALL),
  );
  const [reason, setReason] = useState<PauseReasonCode | null>(null);
  const [startMode, setStartMode] = useState<"today" | "later">(
    initialStart === undefined ? "today" : "later",
  );
  const [startInput, setStartInput] = useState(initialStart ?? "");
  const [endMode, setEndMode] = useState<"fixed" | "open">("fixed");
  const [endInput, setEndInput] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<PauseFailure | null>(null);

  const covered = scope === ALL ? commitments : commitments.filter((c) => c.id === scope);
  const label = scope === ALL ? "todos tus compromisos" : (covered[0]?.habitName ?? "");
  const known = covered.map((c) => remainingDays.get(c.id));
  const quota =
    budgetsKnown && known.every((n) => n !== undefined) ? Math.min(...(known as number[])) : null;
  const privateOnes = covered.filter((c) => c.isPrivate).map((c) => c.habitName);

  const tomorrow = addDays(season.today, 1);
  const start = startMode === "today" ? season.today : startInput;
  const startProblem =
    startMode === "later" &&
    startInput !== "" &&
    (startInput < tomorrow || startInput > season.lastDay)
      ? "Elige un día entre mañana y el final de la temporada."
      : null;
  const days =
    endMode === "fixed" && endInput !== "" && start !== ""
      ? daysBetween(start, endInput) + 1
      : null;
  const endProblem =
    endMode !== "fixed" || endInput === "" || start === ""
      ? null
      : endInput < start
        ? "El último día no puede ser anterior al primero."
        : endInput > season.lastDay
          ? "El último día no puede pasar del final de la temporada."
          : quota !== null && days !== null && days > quota
            ? `Son ${days} días y solo te quedan ${quota} para ${label}.`
            : null;
  const complete =
    reason !== null &&
    start !== "" &&
    (endMode === "open" || endInput !== "") &&
    startProblem === null;
  const blocked = quota === 0 || endProblem !== null || (endMode === "open" && quota === 0);
  const solo = approverNames.length === 0;
  const canSend = complete && !blocked && online && !request.isPending;

  const send = async () => {
    if (reason === null || !canSend) return;
    setFailure(null);
    try {
      await request.mutateAsync({
        scope: scope === ALL ? { kind: "all" } : { kind: "commitment", commitmentId: scope },
        reason,
        note: note.trim() === "" ? null : note.trim(),
        startDate: start,
        endDate: endMode === "open" ? null : endInput,
      });
      toasts.show({ message: solo ? "Pausa activada" : "Solicitud enviada" });
      onClose();
    } catch (error) {
      setFailure(pauseFailure(error));
    }
  };

  return (
    <>
      <div className={styles.content}>
        <fieldset className={styles.group}>
          <legend className={styles.label}>Compromiso</legend>
          <div className={styles.chips}>
            {commitments.map((c) => (
              <Tag key={c.id} selected={scope === c.id} onClick={() => setScope(c.id)}>
                {c.habitName}
              </Tag>
            ))}
            {offersAll && (
              <Tag selected={scope === ALL} onClick={() => setScope(ALL)}>
                Todos
              </Tag>
            )}
          </div>
          {quota === 0 ? (
            <InlineMessage tone="error" title={`No te quedan días de pausa para ${label}.`} />
          ) : (
            quota !== null && (
              <p
                className={styles.quota}
              >{`Te quedan ${daysText(quota)} de pausa para ${label}`}</p>
            )
          )}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.label}>Motivo</legend>
          <div className={styles.chips}>
            {PAUSE_REASON_OPTIONS.map((option) => (
              <Tag
                key={option.value}
                selected={reason === option.value}
                onClick={() => setReason(option.value)}
              >
                {option.label}
              </Tag>
            ))}
          </div>
        </fieldset>

        <div className={styles.group}>
          <span className={styles.label}>Desde</span>
          <SegmentedControl
            label="Desde"
            value={startMode}
            options={[
              { value: "today", label: "Hoy" },
              { value: "later", label: "Otra fecha" },
            ]}
            onChange={setStartMode}
          />
          {startMode === "later" && (
            <TextField
              label="Primer día"
              type="date"
              min={tomorrow}
              max={season.lastDay}
              value={startInput}
              onChange={(event) => setStartInput(event.target.value)}
              {...(startProblem === null ? {} : { error: startProblem })}
            />
          )}
        </div>

        <div className={styles.group}>
          <span className={styles.label}>Hasta</span>
          <SegmentedControl
            label="Hasta"
            value={endMode}
            options={[
              { value: "fixed", label: "Fecha fija" },
              { value: "open", label: "Abierta" },
            ]}
            onChange={setEndMode}
          />
          {endMode === "fixed" ? (
            <TextField
              label="Último día"
              type="date"
              {...(start === "" ? {} : { min: start })}
              max={season.lastDay}
              value={endInput}
              onChange={(event) => setEndInput(event.target.value)}
              {...(endProblem === null ? {} : { error: endProblem })}
            />
          ) : (
            <p className={styles.small}>
              Hasta que la reanudes. No se puede empezar en una fecha pasada.
            </p>
          )}
        </div>

        <div className={styles.group}>
          <TextField
            label="Nota (opcional)"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className={styles.small}>
            {privateOnes.length === 0
              ? "El círculo verá la nota que escribas."
              : privateOnes.length === 1
                ? `${privateOnes[0]} es privado, pero el círculo verá esta nota.`
                : `${commitmentList(privateOnes)} son privados, pero el círculo verá esta nota.`}
          </p>
        </div>

        {!solo && (
          <p className={styles.small}>
            {`${approverNames.length === 1 ? "Lo aprueba" : "Lo aprueban"} ${commitmentList(approverNames)}. Si nadie responde en 48 h, se aprueba sola.`}
          </p>
        )}
        {!online && (
          <p className={styles.small}>
            Sin conexión: vuelve a conectarte para enviar la solicitud.
          </p>
        )}
        {failure !== null && <FailureDetails failure={failure} commitments={commitments} />}
      </div>
      <div className="pj-sheet__actions">
        <Button block disabled={!canSend} onClick={send}>
          {solo ? "Pausar ahora" : "Enviar solicitud"}
        </Button>
        <Button variant="ghost" block disabled={request.isPending} onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </>
  );
}

/**
 * Screen 26, "Pausar un compromiso" (PS-1..PS-5): who the pause covers, why, from when and until
 * when, with the days left and who answers. Input survives a server error; writes need a connection.
 */
export function RequestPauseSheet({
  open,
  onClose,
  initialCommitmentId,
  initialStart,
}: RequestPauseSheetProps) {
  const context = usePauseContext();
  return (
    <Sheet open={open} title="Pausar un compromiso" onClose={onClose}>
      {context.season !== null ? (
        <Form
          season={context.season}
          approverNames={context.approverNames}
          remainingDays={context.remainingDays}
          budgetsKnown={context.budgetsKnown}
          initialCommitmentId={initialCommitmentId}
          initialStart={initialStart}
          onClose={onClose}
        />
      ) : context.loading ? (
        <div aria-busy="true">
          <Skeleton shape="line" lines={3} />
        </div>
      ) : context.failed ? (
        <InlineMessage
          tone="error"
          title="No pudimos cargar tus compromisos."
          action={
            <Button size="sm" variant="secondary" onClick={context.retry}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <p className={styles.small}>No hay una temporada activa para pausar.</p>
      )}
    </Sheet>
  );
}
