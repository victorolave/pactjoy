import type { AppInstall } from "../ports/app-install.ts";

/** Reads the display mode from the browser: the standard media query, and iOS Safari's own flag. */
export class BrowserAppInstall implements AppInstall {
  displayMode(): "standalone" | "browser" {
    // iOS Safari has only `navigator.standalone` for apps added to the home screen.
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const mediaStandalone =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches;
    return iosStandalone || mediaStandalone ? "standalone" : "browser";
  }
}
