import { useState } from "react";
import { useNavigate } from "react-router";
import { useAppInstall } from "../../../context/app-install-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import { useInstallStep } from "../device-state.ts";
import styles from "./InstallStep.module.css";

/** Where the flow goes once the step is done or skipped: login. */
const NEXT_PATH = "/login";

/**
 * "Add to home screen", before login (D9). There is no design for it (Lote 5 has no screen 2); it
 * is built from the onboarding primitives. On iOS there is no install prompt, so it explains the
 * Share menu; where the browser handed over a prompt (Android), "Instalar" shows it from a tap.
 * Either way the step is skippable and is not asked again on this device. The gate keeps this
 * screen away from an installed app and from browsers that cannot install; it shows wherever the
 * browser can (iOS, or any browser that fired `beforeinstallprompt`, desktop Chrome and Edge included).
 */
export function InstallStep() {
  const appInstall = useAppInstall();
  const { markDone } = useInstallStep();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const ios = appInstall.platform() === "ios";

  const finish = () => {
    markDone();
    navigate(NEXT_PATH, { replace: true });
  };

  const install = async () => {
    setBusy(true);
    try {
      await appInstall.prompt();
    } catch {
      // The browser threw instead of answering. Nothing to show: treat it like a dismissal.
    } finally {
      setBusy(false);
    }
    // Accepted, dismissed, unavailable or failed: move on either way.
    finish();
  };

  return (
    <FlowScreen
      title="Ten PactJoy en tu pantalla de inicio"
      footer={
        ios ? (
          <Button block onClick={finish}>
            Continuar
          </Button>
        ) : (
          <div className={styles.actions}>
            <Button block disabled={busy} onClick={install}>
              Instalar
            </Button>
            <Button block variant="ghost" onClick={finish}>
              Ahora no
            </Button>
          </div>
        )
      }
    >
      <Illustration alt="PactJoy en la pantalla de inicio de un teléfono" />
      <p className={styles.body}>
        Se abre como una app, a pantalla completa, y tu sesión queda ahí. Es opcional.
      </p>
      {ios && (
        // biome-ignore lint/a11y/noRedundantRoles: `list-style: none` drops list semantics in WebKit and VoiceOver; the role restores them.
        <ol className={styles.steps} role="list">
          <li>
            <span className={styles.number} aria-hidden="true">
              1
            </span>
            <span>
              Toca <Icon name="share" /> <strong>Compartir</strong>; si no lo ves, ábrelo desde el
              menú ⋯.
            </span>
          </li>
          <li>
            <span className={styles.number} aria-hidden="true">
              2
            </span>
            <span>
              Elige <strong>Agregar a pantalla de inicio</strong>.
            </span>
          </li>
          <li>
            <span className={styles.number} aria-hidden="true">
              3
            </span>
            <span>Abre PactJoy desde el ícono nuevo e inicia sesión ahí.</span>
          </li>
        </ol>
      )}
    </FlowScreen>
  );
}
