import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import {
  EMPTY_OUTBOX,
  type OutboxNotice,
  type OutboxState,
  type QueuedEdit,
  type QueuedRecord,
} from "../../../ports/outbox-store.ts";
import {
  dismissNotices,
  noticeLine,
  noticeTitle,
  reasonText,
  rejectWithNotice,
} from "./notices.ts";
import { localRef } from "./queue.ts";

const record = (localId: string, habitName = "Leer"): QueuedRecord => ({
  kind: "record",
  localId,
  attempted: true,
  habitName,
  command: {
    seasonId: "s1",
    commitmentId: "c1",
    forDate: "2026-10-13",
    value: { kind: "done" },
    note: null,
    clientRequestId: `req-${localId}`,
  },
});
const edit = (id: string, target: string): QueuedEdit => ({
  kind: "edit",
  id,
  target,
  habitName: "Leer",
  forDate: "2026-10-13",
  value: { kind: "quantity", value: "30" },
  note: null,
});

const stateOf = (...items: OutboxState["items"]): OutboxState => ({ ...EMPTY_OUTBOX, items });
const closed = new ApiError("WindowClosed", 422, "req");

describe("rejectWithNotice", () => {
  it("turns a terminal record into one notice with habit, day, action and reason (OE-R4.S5)", () => {
    const { state } = rejectWithNotice(
      stateOf(record("a"), record("b", "Correr")),
      "a",
      closed,
      "n1",
    );
    expect(state.items.map((item) => (item.kind === "record" ? item.localId : item.id))).toEqual([
      "b",
    ]);
    expect(state.notices).toEqual([
      {
        id: "n1",
        habitName: "Leer",
        forDate: "2026-10-13",
        action: "record",
        reason: "closedWindow",
      },
    ]);
  });

  it("folds the dependants into the same notice without a notice of their own (OE-R4.S6)", () => {
    const { state, removed } = rejectWithNotice(
      stateOf(record("a"), edit("e1", localRef("a"))),
      "a",
      closed,
      "n1",
    );
    expect(state.items).toEqual([]);
    expect(state.notices).toHaveLength(1);
    expect(removed.map((item) => (item.kind === "record" ? item.localId : item.id))).toEqual([
      "a",
      "e1",
    ]);
  });

  it("says an edit refused as WindowClosed could not be confirmed (OE-R5.S2)", () => {
    const { state } = rejectWithNotice(stateOf(edit("e1", "entry-1")), "e1", closed, "n1");
    expect(state.notices[0]).toMatchObject({ action: "edit", reason: "unconfirmed" });
  });

  it("keeps the other reasons of an edit as they are", () => {
    const gone = new ApiError("EntryDeleted", 410, "req");
    const { state } = rejectWithNotice(stateOf(edit("e1", "entry-1")), "e1", gone, "n1");
    expect(state.notices[0]).toMatchObject({ action: "edit", reason: "entryGone" });
  });

  it("maps the paused, on-hold and season-closed answers to their reasons (OE-R4.S10)", () => {
    const reasons = ["OpportunityPaused", "OpportunityOnHold", "SeasonNotActive", "NotAMember"].map(
      (code) =>
        rejectWithNotice(stateOf(record("a")), "a", new ApiError(code, 422, "req"), "n").state
          .notices[0]?.reason,
    );
    expect(reasons).toEqual(["paused", "onHold", "closedWindow", "generic"]);
  });

  it("appends to the notices already waiting", () => {
    const first = rejectWithNotice(stateOf(record("a"), record("b")), "a", closed, "n1").state;
    const second = rejectWithNotice(first, "b", closed, "n2").state;
    expect(second.notices.map((notice) => notice.id)).toEqual(["n1", "n2"]);
  });

  it("keeps a private habit's name: it is the owner's own device (OE-R10.S2)", () => {
    const { state } = rejectWithNotice(stateOf(record("a", "Terapia")), "a", closed, "n1");
    expect(state.notices[0]?.habitName).toBe("Terapia");
  });
});

describe("dismissNotices", () => {
  it("removes every notice and keeps the queue", () => {
    const withNotice = rejectWithNotice(stateOf(record("a"), record("b")), "a", closed, "n1").state;
    const state = dismissNotices(withNotice);
    expect(state.notices).toEqual([]);
    expect(state.items).toHaveLength(1);
  });
});

describe("copy", () => {
  const notice = (reason: OutboxNotice["reason"], overrides: Partial<OutboxNotice> = {}) => ({
    id: "n",
    habitName: "Leer",
    forDate: "2026-10-13",
    action: "record" as const,
    reason,
    ...overrides,
  });

  it("explains every reason in Spanish (design: Reasons)", () => {
    expect(reasonText("closedWindow")).toBe("el plazo para registrarlo ya terminó");
    expect(reasonText("paused")).toBe("el compromiso está en pausa");
    expect(reasonText("onHold")).toBe("hay una pausa pendiente de respuesta");
    expect(reasonText("entryGone")).toBe("ese registro ya no existe");
    expect(reasonText("generic")).toBe("ya no se puede registrar en esta temporada");
    expect(reasonText("unconfirmed")).toBe(
      "no pudimos confirmar el cambio; lo que ves es lo que quedó guardado",
    );
    expect(reasonText("bug")).toBe("no se pudo guardar");
    expect(reasonText("noteField")).toBe("no se pudo guardar");
  });

  it("writes one line per notice: habit, weekday and day, reason (OE-R10.S1)", () => {
    expect(noticeLine(notice("closedWindow"))).toBe(
      "Leer · martes 13: el plazo para registrarlo ya terminó.",
    );
  });

  it("titles the card in singular and plural", () => {
    expect(noticeTitle(1)).toBe("No pudimos enviar un registro");
    expect(noticeTitle(3)).toBe("No pudimos enviar 3 registros");
  });
});
