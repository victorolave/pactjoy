import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserVisibility } from "./browser-visibility.ts";

function setState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("BrowserVisibility", () => {
  afterEach(() => setState("visible"));

  it("reads the document's visibility state", () => {
    const visibility = new BrowserVisibility();
    expect(visibility.isVisible()).toBe(true);
    setState("hidden");
    expect(visibility.isVisible()).toBe(false);
  });

  it("reports changes until it is unsubscribed", () => {
    const visibility = new BrowserVisibility();
    const onChange = vi.fn();
    const unsubscribe = visibility.subscribe(onChange);
    setState("hidden");
    setState("visible");
    expect(onChange.mock.calls).toEqual([[false], [true]]);
    unsubscribe();
    setState("hidden");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
