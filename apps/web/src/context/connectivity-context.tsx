import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import type { Connectivity } from "../ports/connectivity.ts";

const ConnectivityContext = createContext<Connectivity | null>(null);

export function ConnectivityProvider({
  connectivity,
  children,
}: {
  readonly connectivity: Connectivity;
  readonly children: ReactNode;
}) {
  return (
    <ConnectivityContext.Provider value={connectivity}>{children}</ConnectivityContext.Provider>
  );
}

/** Like useOnline, but "online" when there is no provider (for shared UI that may sit outside one). */
export function useOptionalOnline(): boolean {
  const connectivity = useContext(ConnectivityContext);
  return useSyncExternalStore(
    (notify) => connectivity?.subscribe(notify) ?? (() => {}),
    () => connectivity?.isOnline() ?? true,
  );
}

/** Whether the app can reach the network. Writes are disabled when it cannot (P1: no write queue). */
export function useOnline(): boolean {
  const connectivity = useContext(ConnectivityContext);
  if (connectivity === null)
    throw new Error("useOnline must be used inside a ConnectivityProvider");
  return useSyncExternalStore(
    (notify) => connectivity.subscribe(notify),
    () => connectivity.isOnline(),
  );
}
