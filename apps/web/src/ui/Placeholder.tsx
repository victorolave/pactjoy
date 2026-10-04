import cocinar from "../design/brand/cocinar.webp";
import crearPacto from "../design/brand/crear-pacto.webp";
import diaDificilCrop from "../design/brand/dia-dificil-crop.webp";
import invitarCirculo from "../design/brand/invitar-circulo.webp";
import onboarding1 from "../design/brand/onboarding-1.webp";
import horizontalLogo from "../design/brand/pactjoy-horizontal-proposed.svg";
import symbolLogo from "../design/brand/pactjoy-symbol-gradient.svg";
import primerHabito from "../design/brand/primer-habito.webp";
import registroGuardado from "../design/brand/registro-guardado.webp";
import sinConexion from "../design/brand/sin-conexion.webp";
import styles from "./Placeholder.module.css";

const ILLUSTRATIONS = {
  "registro-guardado": registroGuardado,
  "sin-conexion": sinConexion,
  cocinar,
  "crear-pacto": crearPacto,
  "onboarding-1": onboarding1,
  "dia-dificil-crop": diaDificilCrop,
  "primer-habito": primerHabito,
  "invitar-circulo": invitarCirculo,
} as const;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

export interface IllustrationProps {
  readonly alt: string;
  /** One of the official illustrations this app uses. */
  readonly name?: IllustrationName;
  /** Another image. It wins over `name`. */
  readonly src?: string;
  /**
   * The design's boxes, the image contained in each: `lg` 200 square (confirmation), `md` 130 high
   * and `banner` 150 high, `hero` 220 high and `story` 320 high, all full width (empty day, offline, create circle, welcome carousel). Without it the image fills the width.
   */
  readonly size?: "lg" | "md" | "banner" | "hero" | "story";
}

/** Without a name or a src a neutral block is drawn and no image is requested. */
export function Illustration({ alt, name, src, size }: IllustrationProps) {
  const url = src ?? (name === undefined ? undefined : ILLUSTRATIONS[name]);
  if (url !== undefined && size !== undefined) {
    return <img className={styles.imageSized} data-size={size} src={url} alt={alt} />;
  }
  if (url !== undefined) {
    return <img className={styles.image} src={url} alt={alt} />;
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
