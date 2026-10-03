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
  readonly src?: string;
}

/** Never composes the wordmark in live text: the master file is used, or a neutral mark. */
export function Logo({ src }: LogoProps) {
  if (src !== undefined) return <img className={styles.logoImage} src={src} alt="PactJoy" />;
  return <div className={`${styles.placeholder} ${styles.logo}`} role="img" aria-label="PactJoy" />;
}
