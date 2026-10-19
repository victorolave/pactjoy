import { useRef, useState } from "react";
import { useClock } from "../../../context/clock-context.tsx";
import { epochMs } from "../../../shared/epoch.ts";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import styles from "./PhotoField.module.css";
import type { PhotoUploadState } from "./photo-upload.ts";

/** The photo the entry already has (an edit): a signed link and when it stops working. */
export interface ExistingPhoto {
  readonly url: string;
  readonly expiresAt: number | string;
}

export interface PhotoFieldProps {
  readonly state: PhotoUploadState;
  /** The entry's current photo while no new one has been picked and it was not removed. */
  readonly existing: ExistingPhoto | null;
  readonly online: boolean;
  /** A missed entry carries no photo. */
  readonly missed: boolean;
  readonly onPick: (file: File) => void;
  readonly onRetry: () => void;
  /** Drops the picked photo, or the entry's current one when nothing was picked. */
  readonly onRemove: () => void;
}

/**
 * The optional photo of an entry (design 19): a plain file input (the phone offers camera and
 * library; nothing forces capture), a 96 px thumbnail with a "Cambiar" tile, and the states of the
 * upload. Visibility help lives with the note, which says it covers the photo too.
 */
export function PhotoField({
  state,
  existing,
  online,
  missed,
  onPick,
  onRetry,
  onRemove,
}: PhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const disabled = !online || missed;
  const open = () => inputRef.current?.click();
  const hidden = (
    <input
      ref={inputRef}
      className={styles.input}
      type="file"
      accept="image/jpeg,image/heic,image/*"
      tabIndex={-1}
      aria-hidden="true"
      disabled={disabled}
      onChange={(event) => {
        const file = event.target.files?.[0];
        // Reset so picking the same file again still fires a change.
        event.target.value = "";
        if (file !== undefined) onPick(file);
      }}
    />
  );
  const notice = !online ? (
    <p className={styles.note}>La foto necesita conexión.</p>
  ) : missed ? (
    <p className={styles.note}>Las fotos van con un registro hecho</p>
  ) : null;

  const showing =
    state.status === "uploading" ||
    state.status === "ready" ||
    state.status === "failed" ||
    (state.status === "idle" && existing !== null);

  return (
    <div className={styles.field}>
      <span className="pj-field__label">Foto (opcional)</span>
      {hidden}
      {state.status === "preparing" && (
        <p role="status" className={styles.note}>
          Preparando foto…
        </p>
      )}
      {state.status === "unusable" && (
        <InlineMessage tone="error" title="Esta imagen no se puede usar" />
      )}
      {showing && (
        <div className={styles.tiles}>
          <Thumb
            src={state.status === "idle" ? (existing?.url ?? null) : state.previewUrl}
            expiresAt={
              state.status === "idle" && existing !== null ? epochMs(existing.expiresAt) : null
            }
          />
          {state.status !== "uploading" && (
            <button type="button" className={styles.tile} disabled={disabled} onClick={open}>
              <Icon name="camera" size="sm" />
              Cambiar
            </button>
          )}
        </div>
      )}
      {state.status === "uploading" && (
        <p role="status" className={styles.note}>
          Subiendo foto…
        </p>
      )}
      {state.status === "failed" && (
        <>
          <Button variant="secondary" block disabled={disabled} onClick={onRetry}>
            No se pudo subir la foto · Reintentar
          </Button>
          {state.cause === "limit" && (
            <p className={styles.note}>
              Tienes demasiadas fotos pendientes. Inténtalo en unos minutos.
            </p>
          )}
        </>
      )}
      {(state.status === "ready" ||
        state.status === "failed" ||
        (state.status === "idle" && existing !== null)) && (
        <Button variant="ghost" block disabled={disabled} onClick={onRemove}>
          Quitar foto
        </Button>
      )}
      {(state.status === "unusable" || (state.status === "idle" && existing === null)) && (
        <Button variant="secondary" block leadingIcon="camera" disabled={disabled} onClick={open}>
          Añadir foto
        </Button>
      )}
      {notice}
    </div>
  );
}

/** A 96 px square. The entry's own photo can have an expired or broken link: then a plain tile says so. */
function Thumb({
  src,
  expiresAt,
}: {
  readonly src: string | null;
  readonly expiresAt: number | null;
}) {
  const clock = useClock();
  const [broken, setBroken] = useState(false);
  if (src === null || broken || (expiresAt !== null && !(expiresAt > clock.nowMs()))) {
    return <span className={styles.thumbGone}>Foto no disponible</span>;
  }
  return (
    <img
      className={styles.thumb}
      src={src}
      alt="Foto del registro"
      onError={() => setBroken(true)}
    />
  );
}
