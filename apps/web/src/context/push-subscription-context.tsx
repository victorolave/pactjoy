import { createContext, type ReactNode, useContext } from "react";
import type { PushSubscriptionPort } from "../ports/push-subscription.ts";

const PushSubscriptionContext = createContext<PushSubscriptionPort | null>(null);

export function PushSubscriptionProvider({
  push,
  children,
}: {
  readonly push: PushSubscriptionPort;
  readonly children: ReactNode;
}) {
  return (
    <PushSubscriptionContext.Provider value={push}>{children}</PushSubscriptionContext.Provider>
  );
}

export function usePushSubscription(): PushSubscriptionPort {
  const push = useContext(PushSubscriptionContext);
  if (push === null) {
    throw new Error("usePushSubscription must be used inside a PushSubscriptionProvider");
  }
  return push;
}
