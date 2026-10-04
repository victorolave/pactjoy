import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../../ui/Button.tsx";
import { PagerDots } from "../../../ui/PagerDots.tsx";
import { Illustration, Logo } from "../../../ui/Placeholder.tsx";
import { useWelcomeSeen } from "../device-state.ts";
import styles from "./WelcomeCarousel.module.css";
import { WELCOME_SLIDES } from "./welcome-slides.ts";

/**
 * Where the carousel leads. The install step goes here later (D9: carousel, install, then login);
 * today the next screen is login.
 */
export const AFTER_WELCOME_PATH = "/login";

/**
 * Designs 1a-c: three slides before login. "Saltar" (the first two slides) and the last slide's
 * "Empezar" both mark the carousel as seen on this device, so it is not offered again, and go on.
 */
export function WelcomeCarousel() {
  const [index, setIndex] = useState(0);
  const { markSeen } = useWelcomeSeen();
  const navigate = useNavigate();
  const slide = WELCOME_SLIDES[index];
  if (slide === undefined) return null;
  const last = index === WELCOME_SLIDES.length - 1;

  const finish = () => {
    markSeen();
    navigate(AFTER_WELCOME_PATH, { replace: true });
  };

  return (
    <main className={styles.page}>
      <div className={styles.top} {...(index === 0 ? {} : { "data-end": "" })}>
        {index === 0 && <Logo />}
        {!last && (
          <Button variant="ghost" size="sm" onClick={finish}>
            Saltar
          </Button>
        )}
      </div>
      <div className={styles.slide} aria-live="polite">
        <Illustration
          alt={slide.alt}
          {...(slide.illustration ? { name: slide.illustration } : {})}
        />
        <h1 className={styles.title}>{slide.title}</h1>
        <p className={styles.body}>{slide.body}</p>
      </div>
      <div className={styles.footer}>
        <PagerDots count={WELCOME_SLIDES.length} current={index} />
        <Button block onClick={last ? finish : () => setIndex(index + 1)}>
          {last ? "Empezar" : "Siguiente"}
        </Button>
      </div>
    </main>
  );
}
