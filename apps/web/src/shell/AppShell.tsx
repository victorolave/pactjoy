import type { ReactNode } from "react";
import { Outlet } from "react-router";
import styles from "./AppShell.module.css";
import { TabBar } from "./TabBar.tsx";

/** Layout for the four tab routes: content area plus the TabBar. `children` replaces the routed outlet. */
export function AppShell({ children }: { readonly children?: ReactNode } = {}) {
  return (
    <div className={styles.shell}>
      <main className={styles.content}>{children ?? <Outlet />}</main>
      <div className={styles.tabs}>
        <TabBar />
      </div>
    </div>
  );
}
