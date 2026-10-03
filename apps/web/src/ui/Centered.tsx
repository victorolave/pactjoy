import type { ReactNode } from "react";
import styles from "./Centered.module.css";

/** Centres a secondary control across the width of what contains it ("Hoy no salió", "Ayer no salió"). */
export function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.centered} data-centered="true">
      {children}
    </div>
  );
}
