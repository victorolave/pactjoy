import { describe, expect, it } from "vitest";
import { type WelcomeInput, welcomeRedirect } from "./welcome-redirect.ts";

const at = (over: Partial<WelcomeInput>): WelcomeInput => ({
  pathname: "/login",
  standalone: false,
  welcomeSeen: false,
  ...over,
});

describe("welcomeRedirect", () => {
  it.each<[string, Partial<WelcomeInput>, string | null]>([
    ["browser, not seen, at login: the carousel comes first", {}, "/welcome"],
    [
      "browser, not seen, at the code step: the carousel too",
      { pathname: "/login/code" },
      "/welcome",
    ],
    ["browser, not seen, already on the carousel: stay", { pathname: "/welcome" }, null],
    ["browser, seen, at login: stay", { welcomeSeen: true }, null],
    [
      "browser, seen, on the carousel: stay (it can be replayed)",
      { welcomeSeen: true, pathname: "/welcome" },
      null,
    ],
    ["standalone, not seen, at login: straight to login, no carousel", { standalone: true }, null],
    [
      "standalone, on the carousel: skip it, go to login",
      { standalone: true, pathname: "/welcome" },
      "/login",
    ],
    [
      "standalone and seen, on the carousel: login",
      { standalone: true, welcomeSeen: true, pathname: "/welcome" },
      "/login",
    ],
  ])("%s", (_name, input, expected) => {
    expect(welcomeRedirect(at(input))).toBe(expected);
  });
});
