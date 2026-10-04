import { createContext, type ReactNode, useContext } from "react";
import type { DeviceStore } from "../ports/device-store.ts";

const DeviceStoreContext = createContext<DeviceStore | null>(null);

export function DeviceStoreProvider({
  device,
  children,
}: {
  readonly device: DeviceStore;
  readonly children: ReactNode;
}) {
  return <DeviceStoreContext.Provider value={device}>{children}</DeviceStoreContext.Provider>;
}

export function useDeviceStore(): DeviceStore {
  const device = useContext(DeviceStoreContext);
  if (device === null) {
    throw new Error("useDeviceStore must be used inside a DeviceStoreProvider");
  }
  return device;
}
