/**
 * The public API of the notifications feature (ADR-0017): this device's Web Push lifecycle. The
 * onboarding step and Ajustes turn it on from a tap; the composition re-syncs it on start and
 * removes it on sign-out.
 */

export { NotificationsCard } from "./NotificationsCard.tsx";
export { PushSync, usePushDevice } from "./PushSync.tsx";
export {
  enablePush,
  type PushStatus,
  type PushStep,
  pushStatus,
  removeThisDevice,
} from "./push-device.ts";
export { useReminderNamesSync } from "./use-reminder-names-sync.ts";
