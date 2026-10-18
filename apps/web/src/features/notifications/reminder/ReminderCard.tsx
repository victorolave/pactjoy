import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAppInstall } from "../../../context/app-install-context.tsx";
import { useOnline } from "../../../context/connectivity-context.tsx";
import type { ReminderSettingCommand } from "../../../ports/wire.ts";
import { Card } from "../../../ui/Card.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { usePushDevice } from "../PushSync.tsx";
import { pushStatus } from "../push-device.ts";
import { useCommitmentReminder, useSaveCommitmentReminder } from "../queries.ts";
import styles from "./ReminderCard.module.css";

/** Engine weekdays, 0 = Monday. */
const DAYS = [
  ["L", "Lunes"],
  ["M", "Martes"],
  ["X", "Miércoles"],
  ["J", "Jueves"],
  ["V", "Viernes"],
  ["S", "Sábado"],
  ["D", "Domingo"],
] as const;

const FIRST_MINUTE = 8 * 60;
const LAST_MINUTE = 21 * 60 + 45;
const STEP = 15;
const TIMES = Array.from(
  { length: (LAST_MINUTE - FIRST_MINUTE) / STEP + 1 },
  (_, i) => FIRST_MINUTE + i * STEP,
);
const clock = (minute: number) =>
  `${String((minute - (minute % 60)) / 60).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Whether this device will receive the push: `null` while it is being checked. */
function usePushActive(): boolean | null {
  const deps = usePushDevice();
  const installed = useAppInstall().displayMode() === "standalone";
  const [active, setActive] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    pushStatus({ ...deps, installed })
      .then((status) => live && setActive(status === "active"))
      .catch(() => live && setActive(false));
    return () => {
      live = false;
    };
  }, [deps, installed]);
  return active;
}

/**
 * The owner's reminder for one commitment (ADR-0017 addendum, D2; REQ-R1, R12..R14): a switch,
 * then a time (08:00-21:45, every 15 minutes) and the days, saved on every change. It is a personal
 * setting: it never touches the pact. It never asks for the notification permission; with
 * notifications off on this device it says where to turn them on. Offline it cannot change.
 * Derived copy: the owner approves it at the real-iPhone check.
 */
export function ReminderCard({
  seasonId,
  commitmentId,
}: {
  readonly seasonId: string;
  readonly commitmentId: string;
}) {
  const online = useOnline();
  const pushActive = usePushActive();
  const query = useCommitmentReminder(seasonId, commitmentId);
  const save = useSaveCommitmentReminder(seasonId, commitmentId);

  if (query.data === undefined) {
    return (
      <Card flush>
        <div className={styles.body} aria-busy={query.isPending}>
          {query.isPending ? (
            <Skeleton shape="line" lines={1} />
          ) : (
            <p className={styles.hint}>No pudimos cargar el recordatorio.</p>
          )}
        </div>
      </Card>
    );
  }
  const reminder = query.data;
  const locked = !online || save.isPending;
  const change = (patch: Partial<ReminderSettingCommand>) =>
    save.mutate({
      enabled: reminder.enabled,
      minuteOfDay: reminder.minuteOfDay,
      weekdays: reminder.weekdays,
      ...patch,
    });
  const toggleDay = (day: number) =>
    change({
      weekdays: reminder.weekdays.includes(day)
        ? reminder.weekdays.filter((d) => d !== day)
        : [...reminder.weekdays, day].sort((a, b) => a - b),
    });

  return (
    <Card flush>
      <div className={styles.body}>
        <label className={styles.switchRow}>
          <span>Recordatorio</span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={reminder.enabled}
            className={styles.switch}
            checked={reminder.enabled}
            disabled={locked}
            onChange={(event) => change({ enabled: event.target.checked })}
          />
        </label>
        {reminder.enabled && (
          <>
            <label className={styles.field}>
              Hora
              <select
                className={styles.time}
                value={String(reminder.minuteOfDay)}
                disabled={locked}
                onChange={(event) => change({ minuteOfDay: Number(event.target.value) })}
              >
                {TIMES.map((minute) => (
                  <option key={minute} value={String(minute)}>
                    {clock(minute)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className={styles.days} aria-label="Días">
              {reminder.availableWeekdays.map((day) => {
                const [short, name] = DAYS[day] ?? ["?", "?"];
                const on = reminder.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={styles.day}
                    aria-label={name}
                    aria-pressed={on}
                    // An enabled reminder needs a day: the last one cannot be turned off.
                    disabled={locked || (on && reminder.weekdays.length === 1)}
                    onClick={() => toggleDay(day)}
                  >
                    {short}
                  </button>
                );
              })}
            </fieldset>
            {pushActive === false && (
              <p className={styles.hint}>
                Activa las notificaciones en Ajustes para recibirlo.{" "}
                <Link className={styles.link} to="/profile/settings">
                  Ir a Ajustes
                </Link>
              </p>
            )}
          </>
        )}
        {!online && <p className={styles.hint}>Sin conexión</p>}
        {save.isError && (
          <p className={styles.hint} role="alert">
            No pudimos guardar el recordatorio.
          </p>
        )}
      </div>
    </Card>
  );
}
