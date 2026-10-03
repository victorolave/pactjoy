import { describe, expect, it, vi } from "vitest";
import { createSessionEvents } from "./session-events.ts";

describe("createSessionEvents", () => {
  it("tells every listener when the session expires", () => {
    const events = createSessionEvents();
    const first = vi.fn();
    const second = vi.fn();
    events.onExpire(first);
    events.onExpire(second);
    events.expire();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops telling a listener that unsubscribed", () => {
    const events = createSessionEvents();
    const listener = vi.fn();
    const off = events.onExpire(listener);
    off();
    events.expire();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does nothing when nobody listens", () => {
    expect(() => createSessionEvents().expire()).not.toThrow();
  });
});
