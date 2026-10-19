import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Illustration } from "../../ui/Placeholder.tsx";

/**
 * Design 15g. Entry writes are kept on the phone while there is no connection (ADR-0012 addendum),
 * so the banner says the member can still register.
 */
export const OFFLINE_MESSAGE = "Sin conexión. Puedes registrar; se enviará al volver.";

/** Online again with entries still on the phone: they are being sent. */
export const SYNCING_MESSAGE = "Enviando lo que registraste sin conexión…";

export function OfflineBanner() {
  return (
    <>
      <Illustration name="sin-conexion" alt="Sin conexión" size="banner" />
      <InlineMessage tone="pending" title={OFFLINE_MESSAGE} />
    </>
  );
}

export function SyncingBanner() {
  return <InlineMessage tone="pending" title={SYNCING_MESSAGE} />;
}
