import { useId } from "react";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import type { StepChrome } from "../chrome.ts";
import styles from "../review.module.css";

/** The same bound as an Entry note and a pause note. */
const MAX_LENGTH = 280;

type Field = "helped" | "hard";

export interface ReflectionStepProps {
  readonly chrome: StepChrome;
  readonly helped: string;
  readonly hard: string;
  /** The server's complaint per field, when it named one. */
  readonly errors: Readonly<Record<Field, string | null>>;
  readonly onChange: (field: Field, value: string) => void;
  /** "Saltar" skips only the reflection (A2); the SRBAI questions still follow. */
  readonly onSkip: () => void;
  readonly onNext: () => void;
}

interface AreaProps {
  /** The id of the visible question that names this field. */
  readonly labelledBy: string;
  readonly placeholder: string;
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}

function Area({ labelledBy, placeholder, value, error, onChange }: AreaProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="pj-field">
      <textarea
        id={id}
        aria-labelledby={labelledBy}
        className="pj-input"
        value={value}
        maxLength={MAX_LENGTH}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={error === null ? undefined : errorId}
        {...(error === null ? {} : { "aria-invalid": true })}
      />
      {error !== null && (
        <span id={errorId} className="pj-field__error" role="alert">
          <Icon name="circle-alert" size="sm" />
          {error}
        </span>
      )}
    </div>
  );
}

/** 34: two optional free-text questions, private to the member. No quick suggestions (design). */
export function ReflectionStep({
  chrome,
  helped,
  hard,
  errors,
  onChange,
  onSkip,
  onNext,
}: ReflectionStepProps) {
  const helpedId = useId();
  const hardId = useId();
  return (
    <FlowScreen
      title="¿Qué te ayudó?"
      titleId={helpedId}
      illustration={
        <Illustration
          name="reflexion"
          size="180"
          alt="Un hombre escribe en su cuaderno en la mesa"
        />
      }
      meta="Opcional · solo para ti"
      onBack={chrome.onBack}
      backLabel={chrome.backLabel}
      backIcon={chrome.backIcon}
      progress={chrome.progress}
      footer={
        <div className={styles.footerRow}>
          <Button variant="ghost" onClick={onSkip}>
            Saltar
          </Button>
          <Button block onClick={onNext}>
            Continuar
          </Button>
        </div>
      }
    >
      <div className={styles.reflect}>
        <Area
          labelledBy={helpedId}
          placeholder="Con tus palabras (opcional)"
          value={helped}
          error={errors.helped}
          onChange={(value) => onChange("helped", value)}
        />
        <h2 id={hardId} className={styles.reflectSecond}>
          ¿Qué costó más?
        </h2>
        <Area
          labelledBy={hardId}
          placeholder="Gym después del trabajo…"
          value={hard}
          error={errors.hard}
          onChange={(value) => onChange("hard", value)}
        />
      </div>
    </FlowScreen>
  );
}
