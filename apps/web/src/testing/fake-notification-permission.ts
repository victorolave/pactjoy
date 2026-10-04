import type {
  NotificationPermissionPort,
  NotificationPermissionState,
} from "../ports/notification-permission.ts";

/** Scriptable permission: `default` (not asked yet) unless told otherwise. */
export class FakeNotificationPermission implements NotificationPermissionPort {
  current: NotificationPermissionState;
  /** What the user answers while the state is `default`. */
  answer: "granted" | "denied" | "default" = "granted";
  requests = 0;

  constructor(current: NotificationPermissionState = "default") {
    this.current = current;
  }

  state(): NotificationPermissionState {
    return this.current;
  }

  request(): Promise<NotificationPermissionState> {
    this.requests += 1;
    if (this.current === "default") this.current = this.answer;
    return Promise.resolve(this.current);
  }
}
