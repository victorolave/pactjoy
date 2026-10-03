import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserHaptics } from "./browser-haptics.ts";

const setVibrate = (value: unknown) =>
  Object.defineProperty(navigator, "vibrate", { value, configurable: true });

afterEach(() => setVibrate(undefined));

describe("BrowserHaptics", () => {
  it("vibrates 12 ms, the prototype's light tap", () => {
    const vibrate = vi.fn();
    setVibrate(vibrate);
    new BrowserHaptics().tap();
    expect(vibrate).toHaveBeenCalledWith(12);
  });

  it("does nothing where vibration does not exist", () => {
    setVibrate(undefined);
    expect(() => new BrowserHaptics().tap()).not.toThrow();
  });

  it("never throws when the browser refuses", () => {
    setVibrate(() => {
      throw new Error("blocked");
    });
    expect(() => new BrowserHaptics().tap()).not.toThrow();
  });
});
