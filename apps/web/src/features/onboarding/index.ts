/**
 * The public API of the onboarding feature: the welcome carousel, the install step, the name step, the pure redirect decisions the shell's
 * gates wire, and the device-only name draft that the circle screens use to prefill displayName.
 * Everything else under `features/onboarding` is internal.
 */
export {
  DISPLAY_NAME_MAX,
  displayNameProblem,
  useInstallStep,
  useNameDraft,
  useWelcomeSeen,
} from "./device-state.ts";
export {
  NAME_STEP_PATH,
  type OnboardingInput,
  onboardingRedirect,
} from "./gate/onboarding-redirect.ts";
export {
  INSTALL_PATH,
  WELCOME_PATH,
  type WelcomeInput,
  welcomeRedirect,
} from "./gate/welcome-redirect.ts";
export { InstallStep } from "./install/InstallStep.tsx";
export { NameStep } from "./name/NameStep.tsx";
export { WelcomeCarousel } from "./welcome/WelcomeCarousel.tsx";
