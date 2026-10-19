import { describe, expect, it, vi } from "vitest";
import { EMPTY_OUTBOX, type OutboxState, type OutboxStore } from "../ports/outbox-store.ts";

/** A small state with one of each kind of content, so a round trip proves nothing is dropped. */
export function sampleOutbox(): OutboxState {
  return {
    v: 1,
    items: [
      {
        kind: "record",
        localId: "r1",
        attempted: false,
        habitName: "Dibujar",
        command: {
          seasonId: "s1",
          commitmentId: "c1",
          forDate: "2026-10-13",
          value: { kind: "done" },
          note: null,
          clientRequestId: "req-1",
        },
      },
      {
        kind: "edit",
        id: "e1",
        target: "entry-9",
        habitName: "Leer",
        forDate: "2026-10-12",
        value: { kind: "quantity", value: "30" },
        note: "capítulo 3",
      },
    ],
    notices: [
      {
        id: "n1",
        habitName: "Correr",
        forDate: "2026-10-11",
        action: "record",
        reason: "closedWindow",
      },
    ],
  };
}

/** The behaviour every `OutboxStore` (the adapter and its test fake) must share. */
export function describeOutboxStoreContract(name: string, make: () => OutboxStore): void {
  describe(`${name} (OutboxStore contract)`, () => {
    it("loads an empty outbox for a user with nothing stored", () => {
      expect(make().load("user-1")).toEqual(EMPTY_OUTBOX);
    });

    it("round-trips a state in the same order", () => {
      const store = make();
      store.save("user-1", sampleOutbox());
      expect(store.load("user-1")).toEqual(sampleOutbox());
    });

    it("never shows one user's state to another (OE-R3.S2)", () => {
      const store = make();
      store.save("user-1", sampleOutbox());
      expect(store.load("user-2")).toEqual(EMPTY_OUTBOX);
    });

    it("clearAll forgets every user (OE-R6.S1)", () => {
      const store = make();
      store.save("user-1", sampleOutbox());
      store.save("user-2", sampleOutbox());
      store.clearAll();
      expect(store.load("user-1")).toEqual(EMPTY_OUTBOX);
      expect(store.load("user-2")).toEqual(EMPTY_OUTBOX);
    });

    it("clearAll tells subscribers, so an outbox in this tab forgets what it holds (OE-R6.S5)", () => {
      const store = make();
      const onChange = vi.fn();
      store.subscribe(onChange);
      store.clearAll();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("clearExcept keeps one user's state and forgets every other user (W4)", () => {
      const store = make();
      store.save("user-1", sampleOutbox());
      store.save("user-2", sampleOutbox());
      store.clearExcept("user-2");
      expect(store.load("user-1")).toEqual(EMPTY_OUTBOX);
      expect(store.load("user-2")).toEqual(sampleOutbox());
    });

    it("clearExcept tells subscribers, like clearAll", () => {
      const store = make();
      const onChange = vi.fn();
      store.subscribe(onChange);
      store.clearExcept("user-2");
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("stops calling a listener once it unsubscribed", () => {
      const store = make();
      const onChange = vi.fn();
      const unsubscribe = store.subscribe(onChange);
      unsubscribe();
      store.clearAll();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
}
