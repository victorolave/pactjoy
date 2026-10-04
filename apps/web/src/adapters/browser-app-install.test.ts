import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserAppInstall } from "./browser-app-install.ts";

const matches = (value: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: value }) as unknown as typeof window.matchMedia,
  );
const iosFlag = (value: boolean | undefined) =>
  Object.defineProperty(navigator, "standalone", { value, configurable: true });

/** A window that records its listeners so the test can fire the browser's events. */
function fakeWindow() {
  const listeners = new Map<string, (event: Event) => void>();
  return {
    target: {
      addEventListener: (type: string, listener: (event: Event) => void) =>
        void listeners.set(type, listener),
    } as unknown as Window,
    fire: (type: string, event: Event = new Event(type)) => listeners.get(type)?.(event),
  };
}

function installEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  return Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  iosFlag(undefined);
});

describe("BrowserAppInstall display mode", () => {
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

describe("BrowserAppInstall platform", () => {
  const userAgent = (ua: string, platform = "", touch = 0) => {
    vi.stubGlobal("navigator", { userAgent: ua, platform, maxTouchPoints: touch });
  };

  it("is ios for an iPhone", () => {
    userAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    expect(new BrowserAppInstall().platform()).toBe("ios");
  });

  it("is ios for an iPad that reports itself as a touch Mac", () => {
    userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5);
    expect(new BrowserAppInstall().platform()).toBe("ios");
  });

  it("is other for Android and for a desktop Mac without touch", () => {
    userAgent("Mozilla/5.0 (Linux; Android 14) Chrome/120");
    expect(new BrowserAppInstall().platform()).toBe("other");
    userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0);
    expect(new BrowserAppInstall().platform()).toBe("other");
  });
});

describe("BrowserAppInstall prompt", () => {
  it("has no prompt until the browser offers one", async () => {
    const win = fakeWindow();
    const install = new BrowserAppInstall(win.target);
    expect(install.canPrompt()).toBe(false);
    expect(await install.prompt()).toBe("unavailable");
  });

  it("keeps the offered event, silences the browser's own banner and shows it on prompt()", async () => {
    const win = fakeWindow();
    const install = new BrowserAppInstall(win.target);
    const event = installEvent("accepted");
    win.fire("beforeinstallprompt", event);
    expect(event.defaultPrevented).toBe(true);
    expect(install.canPrompt()).toBe(true);
    expect(await install.prompt()).toBe("accepted");
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it("reports a dismissal, and the prompt cannot be used twice", async () => {
    const win = fakeWindow();
    const install = new BrowserAppInstall(win.target);
    win.fire("beforeinstallprompt", installEvent("dismissed"));
    expect(await install.prompt()).toBe("dismissed");
    expect(install.canPrompt()).toBe(false);
    expect(await install.prompt()).toBe("unavailable");
  });

  it("drops the prompt once the app is installed", () => {
    const win = fakeWindow();
    const install = new BrowserAppInstall(win.target);
    win.fire("beforeinstallprompt", installEvent("accepted"));
    win.fire("appinstalled");
    expect(install.canPrompt()).toBe(false);
  });
});
