import { describe, expect, it, vi } from "vitest";
import { MemoryOutboxStore } from "./memory-outbox-store.ts";
import { describeOutboxStoreContract, sampleOutbox } from "./outbox-store-contract.ts";

describeOutboxStoreContract("MemoryOutboxStore", () => new MemoryOutboxStore());

describe("MemoryOutboxStore", () => {
  it("notifies subscribers of an external write, not of its own", () => {
    const store = new MemoryOutboxStore();
    const onChange = vi.fn();
    store.subscribe(onChange);
    store.save("user-1", sampleOutbox());
    expect(onChange).not.toHaveBeenCalled();
    store.emitExternal("user-1", sampleOutbox());
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
