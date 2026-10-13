import activarAvisos from "../design/brand/activar-avisos.webp";
import celebrarJuntos from "../design/brand/celebrar-juntos.webp";
import cocinar from "../design/brand/cocinar.webp";
import crearPacto from "../design/brand/crear-pacto.webp";
import diaDificilCrop from "../design/brand/dia-dificil-crop.webp";
import graduarHabito from "../design/brand/graduar-habito.webp";
import caminar from "../design/brand/imagery/caminar.png";
import instalarApp from "../design/brand/instalar-app.webp";
import invitarCirculo from "../design/brand/invitar-circulo.webp";
import metasAndrea from "../design/brand/metas-andrea.webp";
import metasVictor from "../design/brand/metas-victor.webp";
import onboarding1 from "../design/brand/onboarding-1.webp";
import horizontalLogo from "../design/brand/pactjoy-horizontal-proposed.svg";
import symbolLogo from "../design/brand/pactjoy-symbol-gradient.svg";
import primerHabito from "../design/brand/primer-habito.webp";
import reflexion from "../design/brand/reflexion.webp";
import registroGuardado from "../design/brand/registro-guardado.webp";
import revisionEstudiar from "../design/brand/revision-estudiar.webp";
import sinConexion from "../design/brand/sin-conexion.webp";
import styles from "./Placeholder.module.css";

const ILLUSTRATIONS = {
  "registro-guardado": registroGuardado,
  "sin-conexion": sinConexion,
  cocinar,
  caminar,
  "crear-pacto": crearPacto,
  "onboarding-1": onboarding1,
  "dia-dificil-crop": diaDificilCrop,
  "primer-habito": primerHabito,
  "invitar-circulo": invitarCirculo,
  "metas-andrea": metasAndrea,
  "metas-victor": metasVictor,
  reflexion,
  "revision-estudiar": revisionEstudiar,
  "celebrar-juntos": celebrarJuntos,
  "graduar-habito": graduarHabito,
  "instalar-app": instalarApp,
  "activar-avisos": activarAvisos,
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
   * and `banner` 150 high, `hero` 220 high, `story` 320 high and `caminar`/`180` 180 high, all full width
   * (empty day, offline, create circle, welcome carousel, season start). Without it the image fills the width.
   */
  readonly size?: "lg" | "md" | "banner" | "hero" | "story" | "caminar" | "180";
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
