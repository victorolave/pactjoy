import cocinar from "../design/brand/cocinar.webp";
import horizontalLogo from "../design/brand/pactjoy-horizontal-proposed.svg";
import symbolLogo from "../design/brand/pactjoy-symbol-gradient.svg";
import registroGuardado from "../design/brand/registro-guardado.webp";
import sinConexion from "../design/brand/sin-conexion.webp";
import styles from "./Placeholder.module.css";

const ILLUSTRATIONS = {
  "registro-guardado": registroGuardado,
  "sin-conexion": sinConexion,
  cocinar,
} as const;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

export interface IllustrationProps {
  readonly alt: string;
  /** One of the official illustrations this app uses. */
  readonly name?: IllustrationName;
  /** Another image. It wins over `name`. */
  readonly src?: string;
  /** A short banner image instead of a full-width one. */
  readonly compact?: boolean;
  /** A square box (the design's 200 or 130) with the image contained, instead of the full width. */
  readonly size?: "lg" | "md";
}

/** Without a name or a src a neutral block is drawn and no image is requested. */
export function Illustration({ alt, name, src, compact = false, size }: IllustrationProps) {
  const url = src ?? (name === undefined ? undefined : ILLUSTRATIONS[name]);
  if (url !== undefined && size !== undefined) {
    return <img className={styles.imageSized} data-size={size} src={url} alt={alt} />;
  }
  if (url !== undefined) {
    return <img className={compact ? styles.imageCompact : styles.image} src={url} alt={alt} />;
  }
  return (
    <div className={`${styles.placeholder} ${styles.illustration}`} role="img" aria-label={alt} />
  );
}

export interface LogoProps {
  /** The official horizontal logo, or the symbol alone. */
  readonly variant?: "horizontal" | "symbol";
  /** Another logo file. */
  readonly src?: string;
}

const FILES = { horizontal: horizontalLogo, symbol: symbolLogo } as const;

/** Never composes the wordmark in live text: it always renders a master file. */
export function Logo({ variant = "horizontal", src = FILES[variant] }: LogoProps) {
  return <img className={styles.logoImage} src={src} alt="PactJoy" />;
}
