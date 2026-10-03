import { InlineMessage } from "../../ui/InlineMessage.tsx";

/** Copy is placeholder (P8). It never says writes are waiting: there is no write queue (P1). */
export const OFFLINE_MESSAGE =
  "Sin conexión. Estás viendo lo último que se guardó; para registrar necesitas conexión.";

export function OfflineBanner() {
  return <InlineMessage tone="pending" title={OFFLINE_MESSAGE} />;
}
