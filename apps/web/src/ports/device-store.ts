/**
 * The only keys the device store holds (a closed union, so a typo is a compile error).
 *
 * Device-scoped, they survive sign out: `welcomeSeen`, `installStep`, `notificationStep`.
 * Session-scoped, personal, cleared when the session ends: `nameDraft`.
 */
export type DeviceKey =
  | "welcomeSeen"
  | "installStep"
  | "notificationStep"
  | "nameDraft"
  | `pact-closed-seen:${string}`
  | `weekly-summary-seen:${string}`;

/** Small flags and drafts kept on this device only. Storage failures never throw. */
export interface DeviceStore {
  get(key: DeviceKey): string | null;
  set(key: DeviceKey, value: string): void;
  remove(key: DeviceKey): void;
  /** Removes the session-scoped keys (the name draft) and leaves the device flags alone. */
  clearSession(): void;
}
