import { createContext, type ReactNode, useContext } from "react";
import type { NotificationPermissionPort } from "../ports/notification-permission.ts";

const NotificationPermissionContext = createContext<NotificationPermissionPort | null>(null);

export function NotificationPermissionProvider({
  notifications,
  children,
}: {
  readonly notifications: NotificationPermissionPort;
  readonly children: ReactNode;
}) {
  return (
    <NotificationPermissionContext.Provider value={notifications}>
      {children}
    </NotificationPermissionContext.Provider>
  );
}

export function useNotificationPermission(): NotificationPermissionPort {
  const notifications = useContext(NotificationPermissionContext);
  if (notifications === null) {
    throw new Error(
      "useNotificationPermission must be used inside a NotificationPermissionProvider",
    );
  }
  return notifications;
}
