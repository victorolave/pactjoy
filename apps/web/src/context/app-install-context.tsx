import { createContext, type ReactNode, useContext } from "react";
import type { AppInstall } from "../ports/app-install.ts";

const AppInstallContext = createContext<AppInstall | null>(null);

export function AppInstallProvider({
  appInstall,
  children,
}: {
  readonly appInstall: AppInstall;
  readonly children: ReactNode;
}) {
  return <AppInstallContext.Provider value={appInstall}>{children}</AppInstallContext.Provider>;
}

export function useAppInstall(): AppInstall {
  const appInstall = useContext(AppInstallContext);
  if (appInstall === null) {
    throw new Error("useAppInstall must be used inside an AppInstallProvider");
  }
  return appInstall;
}
