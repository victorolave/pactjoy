import type { AppInstall } from "../ports/app-install.ts";

/** Chromium's install prompt event, which TypeScript's DOM lib does not declare. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

/**
 * Reads the display mode and the platform from the browser, and holds on to Chromium's
 * `beforeinstallprompt` event (Android) so the install step can show it from a tap. iOS Safari has
 * neither the event nor an API: it only has `navigator.standalone`.
 */
export class BrowserAppInstall implements AppInstall {
  #deferred: BeforeInstallPromptEvent | null = null;

  /** Create it at start-up: the event can fire before any screen is shown. */
  constructor(target: Pick<Window, "addEventListener"> = window) {
    target.addEventListener("beforeinstallprompt", (event) => {
      // Stop the mini-infobar: the install step asks at the right moment.
      event.preventDefault();
      this.#deferred = event as BeforeInstallPromptEvent;
    });
    target.addEventListener("appinstalled", () => {
      this.#deferred = null;
    });
  }

  displayMode(): "standalone" | "browser" {
    // iOS Safari has only `navigator.standalone` for apps added to the home screen.
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const mediaStandalone =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches;
    return iosStandalone || mediaStandalone ? "standalone" : "browser";
  }

  platform(): "ios" | "other" {
    const { userAgent, platform, maxTouchPoints } = navigator;
    // iPadOS reports itself as a Mac with a touch screen.
    const iPadOs = platform === "MacIntel" && maxTouchPoints > 1;
    return /iPhone|iPad|iPod/.test(userAgent) || iPadOs ? "ios" : "other";
  }

  canPrompt(): boolean {
    return this.#deferred !== null;
  }

  async prompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
    const event = this.#deferred;
    if (event === null) return "unavailable";
    // The event can be prompted once, whatever the answer.
    this.#deferred = null;
    await event.prompt();
    return (await event.userChoice).outcome;
  }
}
