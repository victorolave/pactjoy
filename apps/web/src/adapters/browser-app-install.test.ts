import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserAppInstall } from "./browser-app-install.ts";

const matches = (value: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: value }) as unknown as typeof window.matchMedia,
  );
const iosFlag = (value: boolean | undefined) =>
  Object.defineProperty(navigator, "standalone", { value, configurable: true });

afterEach(() => {
  vi.unstubAllGlobals();
  iosFlag(undefined);
});

describe("BrowserAppInstall", () => {
  it("is standalone when the display-mode media query matches", () => {
    matches(true);
    expect(new BrowserAppInstall().displayMode()).toBe("standalone");
  });

  it("is standalone on iOS when navigator.standalone is true", () => {
    matches(false);
    iosFlag(true);
    expect(new BrowserAppInstall().displayMode()).toBe("standalone");
  });

  it("is a browser tab otherwise", () => {
    matches(false);
    expect(new BrowserAppInstall().displayMode()).toBe("browser");
  });

  it("is a browser tab when matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(new BrowserAppInstall().displayMode()).toBe("browser");
  });
});
