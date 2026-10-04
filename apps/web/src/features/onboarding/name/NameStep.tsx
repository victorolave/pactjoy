import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { Avatar } from "../../../ui/Avatar.tsx";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { displayNameProblem, useNameDraft } from "../device-state.ts";
import styles from "./NameStep.module.css";

/** Where the flow goes once the name is set: create a circle (design 4). */
const NEXT_PATH = "/circle/new";

/**
 * Design 3. The name stays on this device as a draft (no backend call, no photo); it prefills the
 * editable displayName when the user creates or joins a circle.
 */
export function NameStep() {
  const { draft, saveDraft } = useNameDraft();
  const navigate = useNavigate();
  const [name, setName] = useState(draft ?? "");
  const [problem, setProblem] = useState<string | undefined>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = displayNameProblem(name);
    if (found !== null) {
      setProblem(found);
      return;
    }
    saveDraft(name);
    navigate(NEXT_PATH);
  };

  return (
    <FlowScreen
      title="¿Cómo te verá tu círculo?"
      onSubmit={submit}
      footer={
        <Button type="submit" block>
          Continuar
        </Button>
      }
    >
      <div className={styles.avatar}>
        <Avatar name={name} size="lg" />
      </div>
      <TextField
        label="Tu nombre"
        hint="Así aparecerás en la actividad del círculo."
        autoComplete="given-name"
        enterKeyHint="next"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(undefined);
        }}
        {...(problem === undefined ? {} : { error: problem })}
      />
    </FlowScreen>
  );
}
