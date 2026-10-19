import { describe, expect, it } from "vitest";
import { EMPTY_OUTBOX, type OutboxItem } from "../../../ports/outbox-store.ts";
import type { RecordEntryCommand } from "../../../ports/pactjoy-api.ts";
import {
  activeTodayFixture,
  dayRowFixture,
  endedTodayFixture,
  entryFixture,
  noCircleTodayFixture,
  pendingItemFixture,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { NO_MARKS, overlayToday } from "./overlay.ts";
import { type EnqueueInput, enqueue, localRef } from "./queue.ts";

const record = (
  localId: string,
  overrides: Partial<RecordEntryCommand> = {},
  commitmentId = "commitment-1",
): EnqueueInput => ({
  kind: "record",
  localId,
  habitName: "Meditar",
  command: {
    seasonId: "season-1",
    commitmentId,
    forDate: "2026-10-02",
    value: { kind: "done" },
    note: null,
    clientRequestId: `req-${localId}`,
    ...overrides,
  },
});

const edit = (id: string, target: string, value = "45"): EnqueueInput => ({
  kind: "edit",
  id,
  target,
  habitName: "Leer",
  forDate: "2026-10-02",
  value: { kind: "quantity", value },
  note: "capítulo 3",
});

const remove = (id: string, target: string): EnqueueInput => ({
  kind: "delete",
  id,
  target,
  habitName: "Leer",
  forDate: "2026-10-02",
});

/** The items the queue model would hold after these commands. */
function items(...inputs: readonly (EnqueueInput | { readonly attempt: string })[]): OutboxItem[] {
  let state = EMPTY_OUTBOX;
  for (const input of inputs) {
    if ("attempt" in input) {
      state = {
        ...state,
        items: state.items.map((item) =>
          item.kind === "record" && item.localId === input.attempt
            ? { ...item, attempted: true }
            : item,
        ),
      };
      continue;
    }
    const result = enqueue(state, input);
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  }
  return [...state.items];
}

const running = activeTodayFixture();

describe("overlayToday: nothing pending (OE-R7)", () => {
  it("returns the very same view for an empty queue", () => {
    const result = overlayToday(running, []);
    expect(result.view).toBe(running);
    expect(result.marks).toBe(NO_MARKS);
  });

  it("leaves a view without rows alone", () => {
    const none = noCircleTodayFixture();
    expect(overlayToday(none, items(record("a"))).view).toBe(none);
  });
});

describe("overlayToday: a record sent but not yet in the fetched Today", () => {
  const sent = (entryId: string, commitmentId = "commitment-1") => ({
    entryId,
    habitName: "Meditar",
    sentAt: 1,
    command: {
      seasonId: "season-1",
      commitmentId,
      forDate: "2026-10-02",
      value: { kind: "done" as const },
      note: null,
      clientRequestId: `req-${entryId}`,
    },
  });

  it("keeps the row filled and marked with the server's entry id until the fetch has it", () => {
    const { view: shown, marks } = overlayToday(running, [], [sent("entry-7")]);
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.rows[0]?.entries.map((entry) => entry.entryId)).toEqual(["entry-7"]);
    expect(marks.rows.get("commitment-1")).toBe("record");
    expect(marks.entries.get("entry-7")).toBe("record");
    expect(marks.count).toBe(1);
  });

  it("shows nothing extra once the fetched Today already holds the entry", () => {
    const fetched = activeTodayFixture({
      rows: [
        dayRowFixture({
          entries: [entryFixture({ kind: "done" }, { entryId: "entry-7" as never })],
        }),
      ],
    });
    const result = overlayToday(fetched, [], [sent("entry-7")]);
    expect(result.view).toBe(fetched);
    expect(result.marks).toBe(NO_MARKS);
  });
});

describe("overlayToday: a pending record (OE-R7.S1)", () => {
  it("adds a local entry to its row and marks the row and the entry, without touching points", () => {
    const view = activeTodayFixture({ rows: [dayRowFixture(), weekRowFixture()] });
    const { view: shown, marks } = overlayToday(view, items(record("a")));
    if (shown.state !== "active") throw new Error("expected an active view");
    const row = shown.rows[0];
    expect(row?.entries).toEqual([
      expect.objectContaining({
        entryId: "local:a",
        forDate: "2026-10-02",
        value: { kind: "done" },
        note: null,
        photo: null,
      }),
    ]);
    // The server's numbers and the row state are untouched.
    expect(row?.points).toEqual(dayRowFixture().points);
    expect(row?.opportunity).toEqual(dayRowFixture().opportunity);
    expect(shown.summary).toBe(view.summary);
    expect(shown.standings).toBe(view.standings);
    expect(shown.rows[1]).toBe(view.rows[1]);
    expect(marks.rows.get("commitment-1")).toBe("record");
    expect(marks.entries.get("local:a")).toBe("record");
    expect(marks.count).toBe(1);
  });

  it("adds a quantity to a week row", () => {
    const { view: shown } = overlayToday(
      activeTodayFixture(),
      items(
        record(
          "q",
          { commitmentId: "commitment-2", value: { kind: "quantity", value: "20" } },
          "commitment-2",
        ),
      ),
    );
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.rows[1]?.entries).toEqual([
      expect.objectContaining({ entryId: "local:q", value: { kind: "quantity", value: "20" } }),
    ]);
  });

  it("ignores a record for another season or a commitment that is not on Today", () => {
    const other = items(record("a", { seasonId: "season-9" }), record("b", {}, "commitment-404"));
    const { view: shown, marks } = overlayToday(running, other);
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.rows.every((row) => row.entries.length === 0)).toBe(true);
    expect(marks.rows.size).toBe(0);
    // Still counted as pending: the footnote and the syncing line are about the queue.
    expect(marks.count).toBe(2);
  });

  it("works on an ended season's last day too", () => {
    const view = endedTodayFixture();
    const { view: shown, marks } = overlayToday(
      view,
      items(
        record(
          "z",
          { commitmentId: "commitment-2", value: { kind: "quantity", value: "5" } },
          "commitment-2",
        ),
      ),
    );
    if (shown.state !== "ended") throw new Error("expected an ended view");
    expect(shown.rows[0]?.entries).toHaveLength(1);
    expect(marks.rows.get("commitment-2")).toBe("record");
  });
});

describe("overlayToday: yesterday (OE-R7.S2)", () => {
  it("takes the item out of the open ones: it is pending, not still open", () => {
    const view = activeTodayFixture({
      rows: [dayRowFixture({ commitmentId: "commitment-7" as never })],
      pendingYesterday: [
        pendingItemFixture(),
        pendingItemFixture({ commitmentId: "c-8" as never }),
      ],
    });
    const { view: shown, marks } = overlayToday(
      view,
      items(record("y", { forDate: "2026-10-01" }, "commitment-7")),
    );
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.pendingYesterday.map((item) => item.commitmentId)).toEqual(["c-8"]);
    expect(shown.rows[0]?.entries).toEqual([
      expect.objectContaining({ entryId: "local:y", forDate: "2026-10-01" }),
    ]);
    expect(marks.entries.get("local:y")).toBe("record");
  });
});

describe("overlayToday: a pending edit (OE-R7)", () => {
  const logged = () =>
    activeTodayFixture({
      rows: [
        weekRowFixture({
          entries: [
            entryFixture({ kind: "quantity", value: "25" }, { entryId: "entry-1" as never }),
          ],
        }),
      ],
    });

  it("replaces the value and note shown and marks the entry as edited", () => {
    const { view: shown, marks } = overlayToday(logged(), items(edit("e1", "entry-1")));
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.rows[0]?.entries[0]).toMatchObject({
      entryId: "entry-1",
      value: { kind: "quantity", value: "45" },
      note: "capítulo 3",
    });
    expect(marks.entries.get("entry-1")).toBe("edit");
    expect(marks.rows.get("commitment-2")).toBe("edit");
  });

  it("an edit aimed at a record still on the phone changes that record and stays a record", () => {
    const base = activeTodayFixture({ rows: [weekRowFixture()] });
    const queued = items(
      record("a", { value: { kind: "quantity", value: "20" } }, "commitment-2"),
      { attempt: "a" },
      edit("e1", localRef("a"), "30"),
    );
    const { view: shown, marks } = overlayToday(base, queued);
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.rows[0]?.entries).toEqual([
      expect.objectContaining({ entryId: "local:a", value: { kind: "quantity", value: "30" } }),
    ]);
    expect(marks.entries.get("local:a")).toBe("record");
    expect(marks.rows.get("commitment-2")).toBe("record");
  });
});

describe("overlayToday: a pending delete (OE-R7)", () => {
  it("hides the entry and marks the row", () => {
    const view = activeTodayFixture({
      rows: [
        weekRowFixture({
          entries: [
            entryFixture({ kind: "quantity", value: "25" }, { entryId: "entry-1" as never }),
          ],
        }),
      ],
    });
    const { view: shown, marks } = overlayToday(view, items(remove("d1", "entry-1")));
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.rows[0]?.entries).toEqual([]);
    expect(marks.rows.get("commitment-2")).toBe("delete");
  });

  it("hides a record still on the phone that is being deleted after an attempt", () => {
    const queued = items(record("a"), { attempt: "a" }, remove("d1", localRef("a")));
    const { view: shown, marks } = overlayToday(running, queued);
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.rows[0]?.entries).toEqual([]);
    expect(marks.rows.get("commitment-1")).toBe("delete");
  });

  it("an edit of an entry that was deleted next shows nothing of it", () => {
    const view = activeTodayFixture({
      rows: [
        weekRowFixture({
          entries: [
            entryFixture({ kind: "quantity", value: "25" }, { entryId: "entry-1" as never }),
          ],
        }),
      ],
    });
    const { view: shown } = overlayToday(
      view,
      items(remove("d1", "entry-1"), edit("e1", "entry-1")),
    );
    if (shown.state !== "active") throw new Error("expected an active view");
    expect(shown.rows[0]?.entries).toEqual([]);
  });
});
