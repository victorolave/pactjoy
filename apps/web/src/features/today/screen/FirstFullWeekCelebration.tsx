import type { TodayView } from "@pactjoy/app";
import { useEffect, useState } from "react";
import { useDeviceStore } from "../../../context/device-store-context.tsx";
import { useHaptics } from "../../../context/haptics-context.tsx";
import type { DeviceKey } from "../../../ports/device-store.ts";
import { Button } from "../../../ui/Button.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import styles from "./FirstFullWeekCelebration.module.css";

const TITLE = "Tu primera semana completa";

export function FirstFullWeekCelebration({
  view,
  fresh,
}: {
  readonly view: TodayView;
  /** The view is the server's settled answer, online (never a restored or locally written one). */
  readonly fresh: boolean;
}) {
  if (view.state !== "active" && view.state !== "ended") return null;
  const week = view.firstFullWeek;
  if (week == null || !Number.isInteger(week) || week < 0 || week >= view.season.lengthWeeks)
    return null;
  const flag: DeviceKey = `first-full-week-seen:${encodeURIComponent(view.viewerId)}:${encodeURIComponent(view.season.id)}`;
  return <Milestone key={flag} flag={flag} week={week} fresh={fresh} />;
}

function Milestone({
  flag,
  week,
  fresh,
}: {
  readonly flag: DeviceKey;
  readonly week: number;
  readonly fresh: boolean;
}) {
  const device = useDeviceStore();
  const haptics = useHaptics();
  const [shown, setShown] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!fresh || shown || device.get(flag) === "1") return;
    const open = () => {
      // Opening consumes the flag, like the weekly summary; refetch cannot reopen it.
      device.set(flag, "1");
      setShown(true);
    };
    const blocked = () => document.querySelector('[role="dialog"]') !== null;
    if (!blocked()) {
      open();
      return;
    }
    // Another dialog holds it back: it opens as soon as the last one leaves, with no refetch.
    const observer = new MutationObserver(() => {
      if (blocked()) return;
      observer.disconnect();
      open();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [device, flag, fresh, shown]);
  return (
    <Sheet open={shown && !closed} title={TITLE} headless onClose={() => setClosed(true)}>
      <div className={styles.moment}>
        <div className={styles.ribbon} aria-hidden="true" />
        <h2 className={styles.title}>{TITLE}</h2>
        <p className={styles.lead}>
          En la semana {week + 1} cumpliste tu mínimo en todas tus oportunidades activas.
        </p>
        <Button
          block
          onClick={() => {
            setClosed(true);
            haptics.tap();
          }}
        >
          Seguir con mi día
        </Button>
      </div>
    </Sheet>
  );
}
