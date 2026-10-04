import type { AppInstall } from "../ports/app-install.ts";

export interface FakeAppInstallOptions {
  readonly standalone?: boolean;
  readonly platform?: "ios" | "other";
  /** A deferred install prompt is available. */
  readonly canPrompt?: boolean;
}

/** Scriptable AppInstall: a browser tab on a non-iOS phone without a prompt, unless told otherwise. */
export class FakeAppInstall implements AppInstall {
  mode: "standalone" | "browser";
  os: "ios" | "other";
  promptAvailable: boolean;
  /** What `prompt` answers while a prompt is available. */
  promptResult: "accepted" | "dismissed" = "accepted";
  prompts = 0;

  constructor({
    standalone = false,
    platform = "other",
    canPrompt = false,
  }: FakeAppInstallOptions = {}) {
    this.mode = standalone ? "standalone" : "browser";
    this.os = platform;
    this.promptAvailable = canPrompt;
  }

  displayMode(): "standalone" | "browser" {
    return this.mode;
  }

  platform(): "ios" | "other" {
    return this.os;
  }

  canPrompt(): boolean {
    return this.promptAvailable;
  }

  async prompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!this.promptAvailable) return "unavailable";
    this.prompts += 1;
    this.promptAvailable = false;
    return this.promptResult;
  }
}
