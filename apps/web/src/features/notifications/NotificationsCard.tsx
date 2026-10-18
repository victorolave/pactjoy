import { useCallback, useEffect, useState } from "react";
import { useAppInstall } from "../../context/app-install-context.tsx";
import { useOnline } from "../../context/connectivity-context.tsx";
import { Card } from "../../ui/Card.tsx";
import { ListRow } from "../../ui/ListRow.tsx";
import styles from "./NotificationsCard.module.css";
import { usePushDevice } from "./PushSync.tsx";
import { enablePush, type PushStatus, pushStatus, syncSettled } from "./push-device.ts";

const LABEL: Readonly<Record<PushStatus, string>> = {
  active: "Activadas",
  off: "Desactivadas",
  blocked: "Bloqueadas",
  notInstalled: "No disponibles",
  unavailable: "No disponibles",
};

const HINT: Partial<Readonly<Record<PushStatus, string>>> = {
  blocked: "Actívalas en los ajustes del iPhone.",
  notInstalled: "Instala PactJoy en tu pantalla de inicio para recibir avisos.",
};

/**
 * This device's notifications in Ajustes (REQ-N1..N4, ADR-0017): the state, and "Activar" while
 * they are off. There is no per-kind switch: the row reflects the device only. Blocked points to
 * the phone's settings; a browser tab without push asks to install the app; offline, Activar waits.
 * Derived copy, approved by the owner at the real-iPhone check.
 */
export function NotificationsCard() {
  const deps = usePushDevice();
  const appInstall = useAppInstall();
  const online = useOnline();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const installed = appInstall.displayMode() === "standalone";

  const refresh = useCallback(async () => {
    try {
      // Opening Ajustes never subscribes: only the start-up sync and the Activar tap do. It waits for
      // a start-up sync still running, so it does not read a half-done state.
      await syncSettled(deps.push);
      setStatus(await pushStatus({ ...deps, installed }));
    } catch {
      setStatus("unavailable");
    }
  }, [deps, installed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Not async: `enablePush` starts the permission request inside the tap's call stack.
  const activate = () => {
    if (busy) return;
    setBusy(true);
    void enablePush(deps)
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        void refresh();
      });
  };

  const hint = status === "off" && !online ? "Sin conexión." : status && HINT[status];
  return (
    <>
      <Card flush>
        <ListRow label="Notificaciones" value={status === null ? "Comprobando…" : LABEL[status]} />
        {status === "off" && (
          <ListRow label="Activar notificaciones" onClick={activate} disabled={busy || !online} />
        )}
      </Card>
      {hint && <p className={styles.hint}>{hint}</p>}
    </>
  );
}
