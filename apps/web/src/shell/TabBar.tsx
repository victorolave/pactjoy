import { NavLink } from "react-router";
import { Icon, type IconName } from "../ui/icon/Icon.tsx";
import styles from "./TabBar.module.css";

interface Tab {
  readonly to: string;
  readonly label: string;
  readonly icon: IconName;
}

/** Order and labels follow the Lote 0 navigation map (P6). */
const TABS: readonly Tab[] = [
  { to: "/", label: "Hoy", icon: "sun" },
  { to: "/season", label: "Temporada", icon: "calendar-days" },
  { to: "/circle", label: "Círculo", icon: "users" },
  { to: "/profile", label: "Perfil", icon: "user-round" },
];

export function TabBar() {
  return (
    <nav className="pj-tabbar" aria-label="Principal">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to !== "/season"}
          className={`pj-tabbar__item ${styles.item}`}
        >
          <span className="pj-tabbar__pill">
            <Icon name={tab.icon} />
          </span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
