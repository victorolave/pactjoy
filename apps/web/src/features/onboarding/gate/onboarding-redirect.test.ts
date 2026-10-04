import { describe, expect, it } from "vitest";
import { type OnboardingInput, onboardingRedirect } from "./onboarding-redirect.ts";

const base: OnboardingInput = {
  pathname: "/",
  hasCircle: false,
  hasNameDraft: false,
  permissionPending: false,
};

describe("onboardingRedirect", () => {
  it.each<[string, Partial<OnboardingInput>, string | null]>([
    ["unknown circle state never redirects (fail open)", { hasCircle: null }, null],
    ["unknown state on a flow path stays", { hasCircle: null, pathname: "/welcome/name" }, null],
    ["a new user without a circle or draft starts at the name step", {}, "/welcome/name"],
    ["the same user on any tab", { pathname: "/profile" }, "/welcome/name"],
    ["a user with a draft is free to see Today", { hasNameDraft: true }, null],
    ["no circle, on the name step: stay", { pathname: "/welcome/name" }, null],
    ["no circle, on create: stay", { pathname: "/circle/new", hasNameDraft: true }, null],
    ["no circle, on create without a draft: stay", { pathname: "/circle/new" }, null],
    ["a member on Today: stay", { hasCircle: true }, null],
    ["a member on the Circle tab: stay", { hasCircle: true, pathname: "/circle" }, null],
    [
      "a member opening the name step goes home (OB-S8)",
      { hasCircle: true, pathname: "/welcome/name" },
      "/",
    ],
    [
      "a member can still open the invite and join screens",
      { hasCircle: true, pathname: "/circle/invite" },
      null,
    ],
    [
      "a member on create stays: the screen navigates itself after the mutation",
      { hasCircle: true, pathname: "/circle/new" },
      null,
    ],
    [
      "permission due: even a member goes to the step",
      { hasCircle: true, permissionPending: true },
      "/welcome/notifications",
    ],
    [
      "permission due, no circle: the step comes before the name step",
      { permissionPending: true },
      "/welcome/notifications",
    ],
    [
      "permission due, circle state unknown (offline): the step still shows",
      { hasCircle: null, permissionPending: true },
      "/welcome/notifications",
    ],
    [
      "permission due, on the step: stay",
      { pathname: "/welcome/notifications", permissionPending: true },
      null,
    ],
    [
      "permission due, on a deep link: the step comes first",
      { hasCircle: true, pathname: "/circle/invite", permissionPending: true },
      "/welcome/notifications",
    ],
    [
      "step no longer due, a member on it goes home",
      { hasCircle: true, pathname: "/welcome/notifications" },
      "/",
    ],
    [
      "step no longer due, no circle on it goes home, where the name step takes over",
      { pathname: "/welcome/notifications" },
      "/",
    ],
    [
      "step no longer due, circle unknown on it goes home",
      { hasCircle: null, pathname: "/welcome/notifications" },
      "/",
    ],
  ])("%s", (_name, patch, expected) => {
    expect(onboardingRedirect({ ...base, ...patch })).toBe(expected);
  });
});
