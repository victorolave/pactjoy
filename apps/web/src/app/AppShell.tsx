import { Outlet } from "react-router";
import styles from "./AppShell.module.css";
import { TabBar } from "./TabBar.tsx";

/** Layout for the four tab routes: content area plus the TabBar. */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <main className={styles.content}>
        <Outlet />
      </main>
      <div className={styles.tabs}>
        <TabBar />
      </div>
    </div>
  );
}
