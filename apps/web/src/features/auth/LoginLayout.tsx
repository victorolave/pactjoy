import { Outlet } from "react-router";
import { Logo } from "../../ui/Placeholder.tsx";
import styles from "./LoginLayout.module.css";

/** Frame shared by the two login steps (no tab bar). */
export function LoginLayout() {
  return (
    <div className={styles.page}>
      <main className={styles.column}>
        <Logo />
        <Outlet />
      </main>
    </div>
  );
}
