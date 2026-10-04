import { describe, expect, it } from "vitest";
import { type WelcomeInput, welcomeRedirect } from "./welcome-redirect.ts";

const at = (over: Partial<WelcomeInput>): WelcomeInput => ({
  pathname: "/login",
  standalone: false,
  welcomeSeen: false,
  installable: true,
  installDone: false,
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
    ["browser, seen, install done, at login: stay", { welcomeSeen: true, installDone: true }, null],
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
    [
      "browser, seen, install pending, at login: the install step comes before login",
      { welcomeSeen: true },
      "/welcome/install",
    ],
    [
      "browser, seen, install pending, at the code step: the install step too",
      { welcomeSeen: true, pathname: "/login/code" },
      "/welcome/install",
    ],
    ["browser, seen, install done, at login: stay", { welcomeSeen: true, installDone: true }, null],
    [
      "browser, seen, install pending but not installable: stay at login",
      { welcomeSeen: true, installable: false },
      null,
    ],
    [
      "browser, not seen: the carousel still comes before the install step",
      { installable: true, installDone: false },
      "/welcome",
    ],
    ["browser, on the install step and installable: stay", { pathname: "/welcome/install" }, null],
    [
      "browser, on the install step but not installable: login",
      { pathname: "/welcome/install", installable: false },
      "/login",
    ],
    [
      "browser, on the install step again after finishing it: stay (it can be reopened)",
      { pathname: "/welcome/install", installDone: true },
      null,
    ],
    [
      "standalone, on the install step: skip it, go to login",
      { standalone: true, pathname: "/welcome/install" },
      "/login",
    ],
    [
      "standalone, install pending, at login: stay",
      { standalone: true, installable: true, installDone: false },
      null,
    ],
  ])("%s", (_name, input, expected) => {
    expect(welcomeRedirect(at(input))).toBe(expected);
  });
});
