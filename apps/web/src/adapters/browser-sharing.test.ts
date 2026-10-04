import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSharing } from "./browser-sharing.ts";

const set = (name: "share" | "clipboard", value: unknown) =>
  Object.defineProperty(navigator, name, { value, configurable: true });

afterEach(() => {
  set("share", undefined);
  set("clipboard", undefined);
});

const DATA = { title: "PactJoy", text: "Únete con 7K4Q2M" };

describe("BrowserSharing", () => {
  it("canShare follows navigator.share", () => {
    set("share", undefined);
    expect(new BrowserSharing().canShare()).toBe(false);
    set("share", vi.fn());
    expect(new BrowserSharing().canShare()).toBe(true);
  });

  it("shares the title and text", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    set("share", share);
    await expect(new BrowserSharing().share(DATA)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(DATA);
  });

  it("treats closing the sheet as dismissed and rethrows real failures", async () => {
    set("share", vi.fn().mockRejectedValue(new DOMException("closed", "AbortError")));
    await expect(new BrowserSharing().share(DATA)).resolves.toBe("dismissed");
    set("share", vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")));
    await expect(new BrowserSharing().share(DATA)).rejects.toThrow();
  });

  it("copies to the clipboard and rejects when it is missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    set("clipboard", { writeText });
    await new BrowserSharing().copy("7K4Q2M");
    expect(writeText).toHaveBeenCalledWith("7K4Q2M");
    set("clipboard", undefined);
    await expect(new BrowserSharing().copy("x")).rejects.toThrow();
  });
});
