/**
 * The public API of the onboarding feature: the name step, the pure redirect decision the shell's
 * gate wires, and the device-only name draft that the circle screens use to prefill displayName.
 * Everything else under `features/onboarding` is internal.
 */
export {
  DISPLAY_NAME_MAX,
  displayNameProblem,
  useNameDraft,
} from "./device-state.ts";
export {
  NAME_STEP_PATH,
  type OnboardingInput,
  onboardingRedirect,
} from "./gate/onboarding-redirect.ts";
export { NameStep } from "./name/NameStep.tsx";
