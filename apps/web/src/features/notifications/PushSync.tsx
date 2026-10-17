import { useEffect, useMemo } from "react";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { useNotificationPermission } from "../../context/notification-permission-context.tsx";
import { usePushSubscription } from "../../context/push-subscription-context.tsx";
import { type PushDeviceDeps, resyncOnStart } from "./push-device.ts";

/** The ports the device lifecycle needs, from the providers. */
export function usePushDevice(): PushDeviceDeps {
  const permission = useNotificationPermission();
  const push = usePushSubscription();
  const api = usePactJoyApi();
  return useMemo(() => ({ permission, push, api }), [permission, push, api]);
}

/**
 * Re-syncs this device's push registration once per signed-in user and app start (REQ-X5, X6):
 * registers it again when the permission is granted (resubscribing after a key rotation), removes it
 * when the permission was revoked. Renders nothing and never fails the app. The composition passes
 * the signed-in user's id (null when signed out), so this feature does not depend on auth.
 */
export function PushSync({ userId }: { readonly userId: string | null }) {
  const deps = usePushDevice();
  useEffect(() => {
    if (userId === null) return;
    void resyncOnStart(deps);
  }, [userId, deps]);
  return null;
}
