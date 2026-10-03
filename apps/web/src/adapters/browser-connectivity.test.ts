import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserConnectivity } from "./browser-connectivity.ts";

const setOnLine = (value: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);

afterEach(() => vi.restoreAllMocks());

describe("BrowserConnectivity", () => {
  it("reads whether the browser thinks it is online", () => {
    setOnLine(true);
    expect(new BrowserConnectivity().isOnline()).toBe(true);
    setOnLine(false);
    expect(new BrowserConnectivity().isOnline()).toBe(false);
  });

  it("tells subscribers when the connection drops and returns", () => {
    const connectivity = new BrowserConnectivity();
    const seen: boolean[] = [];
    connectivity.subscribe((online) => seen.push(online));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(seen).toEqual([false, true]);
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const connectivity = new BrowserConnectivity();
    const seen: boolean[] = [];
    const off = connectivity.subscribe((online) => seen.push(online));
    off();
    window.dispatchEvent(new Event("offline"));
    expect(seen).toEqual([]);
  });

  it("serves several subscribers independently", () => {
    const connectivity = new BrowserConnectivity();
    const first: boolean[] = [];
    const second: boolean[] = [];
    const offFirst = connectivity.subscribe((online) => first.push(online));
    connectivity.subscribe((online) => second.push(online));
    window.dispatchEvent(new Event("offline"));
    offFirst();
    window.dispatchEvent(new Event("online"));
    expect(first).toEqual([false]);
    expect(second).toEqual([false, true]);
  });
});
