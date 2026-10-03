import horizontalLogo from "../design/brand/pactjoy-horizontal-proposed.svg";
import symbolLogo from "../design/brand/pactjoy-symbol-gradient.svg";
import styles from "./Placeholder.module.css";

export interface IllustrationProps {
  readonly alt: string;
  /** Without a src a neutral block is drawn and no image is requested. */
  readonly src?: string;
}

export function Illustration({ alt, src }: IllustrationProps) {
  if (src !== undefined) return <img className={styles.image} src={src} alt={alt} />;
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
