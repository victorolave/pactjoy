import type { Dispatch } from "react";
import { useId } from "react";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { CATEGORY_ICONS, HABIT_ICONS, iconFor } from "../icon-catalog.ts";
import { Choices } from "./Choices.tsx";
import styles from "./Wizard.module.css";
import type { Category, WizardAction, WizardDraft } from "./wizard-model.ts";

const CATEGORIES = Object.keys(CATEGORY_ICONS) as Category[];

export function IdentityStep({
  draft,
  dispatch,
}: {
  readonly draft: WizardDraft;
  readonly dispatch: Dispatch<WizardAction>;
}) {
  const whyId = useId();
  return (
    <div className={styles.stack}>
      <Choices
        label="¿Qué hábito quieres trabajar?"
        value={CATEGORIES.find((category) => category === draft.category) ?? null}
        compact
        options={CATEGORIES.map((category) => ({
          value: category,
          label: category,
          icon: <Icon name={iconFor(CATEGORY_ICONS[category])} />,
        }))}
        onChange={(category) => dispatch({ type: "category", category })}
      />
      <TextField
        label="Nombre"
        value={draft.name}
        maxLength={120}
        onChange={(event) => dispatch({ type: "patch", patch: { name: event.target.value } })}
      />
      <div className="pj-field">
        <label className="pj-field__label" htmlFor={whyId}>
          ¿Por qué quieres este hábito? (opcional)
        </label>
        <textarea
          id={whyId}
          className={`pj-input ${styles.textarea}`}
          value={draft.why}
          maxLength={500}
          aria-describedby={`${whyId}-hint`}
          placeholder="Para desconectar de la pantalla antes de dormir."
          onChange={(event) => dispatch({ type: "patch", patch: { why: event.target.value } })}
        />
        <span id={`${whyId}-hint`} className="pj-field__hint">
          Solo tú lo verás. Te lo recordaremos en las revisiones.
        </span>
      </div>
      <div className={styles.stack}>
        <strong>Ícono</strong>
        <Choices
          label="Ícono"
          iconsOnly
          value={draft.icon}
          compact
          options={HABIT_ICONS.map((icon) => ({
            value: icon.key,
            label: icon.key,
            icon: <Icon name={icon.glyph} />,
          }))}
          onChange={(icon) => dispatch({ type: "patch", patch: { icon } })}
        />
      </div>
    </div>
  );
}
