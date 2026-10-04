import { useState } from "react";
import { useNavigate } from "react-router";
import { useNotificationPermission } from "../../../context/notification-permission-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import { useNotificationStep } from "../device-state.ts";
import styles from "./NotificationStep.module.css";

/** Where the flow goes once the step is done or skipped; the gate sends a new user to the name step. */
const NEXT_PATH = "/";

/**
 * The notification-permission step, the first screen after login in an installed app (D9, OB-R4).
 * There is no design for it (Lote 5 has no such screen); it is built from the onboarding
 * primitives. The browser's prompt opens only from the "Activar" tap, with nothing awaited before
 * it (iOS refuses it otherwise). Whatever the answer, even a refusal, the user moves on and the
 * step is not asked again on this device. Nothing is subscribed and nothing is sent yet, so the
 * copy does not promise notifications.
 */
export function NotificationStep() {
  const notifications = useNotificationPermission();
  const { markDone } = useNotificationStep();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const finish = () => {
    markDone();
    navigate(NEXT_PATH, { replace: true });
  };

  // Not async: `request` must start inside the tap's call stack.
  const activate = () => {
    setBusy(true);
    void notifications.request().finally(() => {
      setBusy(false);
      finish();
    });
  };

  return (
    <FlowScreen
      title="¿Quieres recibir avisos?"
      footer={
        <div className={styles.actions}>
          <Button block disabled={busy} onClick={activate}>
            Activar
          </Button>
          <Button block variant="ghost" disabled={busy} onClick={finish}>
            Ahora no
          </Button>
        </div>
      }
    >
      <Illustration alt="Un aviso de PactJoy en la pantalla de un teléfono" />
      <p className={styles.body}>
        Permite las notificaciones de PactJoy en este teléfono. Es opcional: puedes seguir sin
        ellas.
      </p>
      <p className={styles.note}>Por ahora no enviamos ninguna.</p>
    </FlowScreen>
  );
}
