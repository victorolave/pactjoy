import type { AppInstall } from "../ports/app-install.ts";

/** Scriptable AppInstall: a browser tab unless told it is installed. */
export class FakeAppInstall implements AppInstall {
  mode: "standalone" | "browser";

  constructor(standalone = false) {
    this.mode = standalone ? "standalone" : "browser";
  }

  displayMode(): "standalone" | "browser" {
    return this.mode;
  }
}
