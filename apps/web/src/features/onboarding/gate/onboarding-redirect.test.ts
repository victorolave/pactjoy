import { describe, expect, it } from "vitest";
import { type OnboardingInput, onboardingRedirect } from "./onboarding-redirect.ts";

const base: OnboardingInput = { pathname: "/", hasCircle: false, hasNameDraft: false };

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
  ])("%s", (_name, patch, expected) => {
    expect(onboardingRedirect({ ...base, ...patch })).toBe(expected);
  });
});
