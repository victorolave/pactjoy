import type { OutboxItem, OutboxNotice, OutboxState } from "../../../ports/outbox-store.ts";
import { weekdayDay } from "../../../shared/format.ts";
import { toUiError } from "../../../shared/ui-error.ts";
import { itemId, rejectItem } from "./queue.ts";

const dayOf = (item: OutboxItem): string =>
  item.kind === "record" ? item.command.forDate : item.forDate;

/** The reason shown for a rejection. An edit may have reached the server before the window closed. */
function reasonFor(item: OutboxItem, error: unknown): OutboxNotice["reason"] {
  const { kind, code } = toUiError(error);
  return item.kind === "edit" && code === "WindowClosed" ? "unconfirmed" : kind;
}

/**
 * A terminal answer: the item and whatever waits for it leave the queue and ONE notice records it
 * (nothing is lost silently, OE-R5). The notice stays until the member dismisses it.
 */
export function rejectWithNotice(
  state: OutboxState,
  id: string,
  error: unknown,
  noticeId: string,
): { readonly state: OutboxState; readonly removed: readonly OutboxItem[] } {
  const rejected = rejectItem(state, id);
  const root = rejected.removed.find((item) => itemId(item) === id);
  if (root === undefined) return rejected;
  // The member deleted it themselves: it is gone as they wanted, so there is nothing to tell.
  if (root.kind === "record" && rejected.removed.some((item) => item.kind === "delete")) {
    return rejected;
  }
  const notice: OutboxNotice = {
    id: noticeId,
    habitName: root.habitName,
    forDate: dayOf(root),
    action: root.kind,
    reason: reasonFor(root, error),
  };
  return {
    state: { ...rejected.state, notices: [...rejected.state.notices, notice] },
    removed: rejected.removed,
  };
}

export function dismissNotices(state: OutboxState): OutboxState {
  return { ...state, notices: [] };
}

/** Placeholder Spanish copy (the design has none for these): listed for owner approval. */
export function reasonText(reason: OutboxNotice["reason"]): string {
  switch (reason) {
    case "closedWindow":
      return "el plazo para registrarlo ya terminó";
    case "paused":
      return "el compromiso está en pausa";
    case "onHold":
      return "hay una pausa pendiente de respuesta";
    case "entryGone":
      return "ese registro ya no existe";
    case "generic":
      return "ya no se puede registrar en esta temporada";
    case "unconfirmed":
      return "no pudimos confirmar el cambio; lo que ves es lo que quedó guardado";
    default:
      return "no se pudo guardar";
  }
}

/** "Leer · martes 13: el plazo para registrarlo ya terminó." */
export function noticeLine(notice: OutboxNotice): string {
  const day = weekdayDay(notice.forDate).toLowerCase();
  return `${notice.habitName} · ${day}: ${reasonText(notice.reason)}.`;
}

export function noticeTitle(count: number): string {
  return count === 1 ? "No pudimos enviar un registro" : `No pudimos enviar ${count} registros`;
}
