import { useEffect, useRef, useState } from "react";
import { useClock } from "../context/clock-context.tsx";
import styles from "./EvidencePhoto.module.css";

export interface EvidencePhotoProps {
  /** A short-lived signed download URL. */
  readonly url: string;
  /** When that URL stops working, in epoch milliseconds. */
  readonly expiresAt: number;
  /**
   * Called ONCE when the photo cannot be shown (the link expired or the image failed to load), so the
   * screen can refetch its read and get a fresh link. It is not called again for this photo.
   */
  readonly onUnavailable?: () => void;
}

/** A signed photo, or "Foto no disponible": never a broken image (REQ-W7). */
export function EvidencePhoto({ url, expiresAt, onUnavailable }: EvidencePhotoProps) {
  const clock = useClock();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const reported = useRef(false);
  // An expired link is not even requested: the browser would only get a 403.
  // `!(a > b)` so a NaN expiry counts as expired, never as valid.
  const unavailable = !(expiresAt > clock.nowMs()) || failedUrl === url;

  useEffect(() => {
    if (!unavailable || reported.current) return;
    reported.current = true;
    onUnavailable?.();
  }, [unavailable, onUnavailable]);

  if (unavailable) return <p className={styles.unavailable}>Foto no disponible</p>;
  return (
    <img
      className={styles.photo}
      src={url}
      alt="Foto del registro"
      loading="lazy"
      onError={() => setFailedUrl(url)}
    />
  );
}
