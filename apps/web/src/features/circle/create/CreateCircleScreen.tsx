import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../../ui/Button.tsx";
import { ButtonLink } from "../../../ui/ButtonLink.tsx";
import { Card } from "../../../ui/Card.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { displayNameProblem, useNameDraft } from "../../onboarding/index.ts";
import { circleFailure } from "../circle-messages.ts";
import { useCreateCircle } from "../queries.ts";
import styles from "./CreateCircleScreen.module.css";

/** Where a new circle lands. The invite screen (design 5) takes this over with the Circle tab. */
const AFTER_CREATE_PATH = "/circle";
/** Joining by code (design 6a). */
const JOIN_PATH = "/circle/join";

type FieldErrors = { name?: string | undefined; displayName?: string | undefined };

/**
 * Design 4. A circle of 1 to 6 people (a solo circle is valid, so the copy never says "2"). The
 * member's displayName starts from the device's name draft and stays editable.
 */
export function CreateCircleScreen() {
  const { draft } = useNameDraft();
  const navigate = useNavigate();
  const create = useCreateCircle();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState(draft ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    setFailure(undefined);
    const found = {
      ...(name.trim() === "" ? { name: "Ponle un nombre al círculo." } : {}),
      ...(displayNameProblem(displayName) === null
        ? {}
        : { displayName: displayNameProblem(displayName) as string }),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await create.mutateAsync({ name: name.trim(), displayName: displayName.trim() });
      navigate(AFTER_CREATE_PATH);
    } catch (error) {
      const { message, field } = circleFailure(error);
      if (field === "name" || field === "displayName") setErrors({ [field]: message });
      else setFailure(message);
    }
  };

  return (
    <FlowScreen
      title="Tu círculo empieza aquí"
      onSubmit={submit}
      footer={
        <Button type="submit" block disabled={create.isPending}>
          Crear círculo
        </Button>
      }
    >
      <p className={styles.lead}>De 1 a 6 personas. Funciona especialmente bien en pareja.</p>
      <Illustration
        name="crear-pacto"
        size="hero"
        alt="Dos personas chocan los puños, cada una con su cuaderno"
      />
      <TextField
        label="Nombre del círculo"
        hint="Lo verán todos los miembros. Puedes cambiarlo después."
        enterKeyHint="next"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setErrors((current) => ({ ...current, name: undefined }));
        }}
        {...(errors.name === undefined ? {} : { error: errors.name })}
      />
      <TextField
        label="Tu nombre en el círculo"
        hint="Así te verán los demás. Puedes cambiarlo después."
        autoComplete="given-name"
        enterKeyHint="done"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
          setErrors((current) => ({ ...current, displayName: undefined }));
        }}
        {...(errors.displayName === undefined ? {} : { error: errors.displayName })}
      />
      {failure !== undefined && <InlineMessage tone="error" title={failure} />}
      <Card tone="sunken">
        <div className={styles.invited}>
          <div className={styles.invitedTitle}>¿Te invitaron?</div>
          <div className={styles.lead}>Si alguien ya creó el círculo, únete con su código.</div>
          <div>
            <ButtonLink to={JOIN_PATH} variant="ghost" size="sm">
              Tengo un código
            </ButtonLink>
          </div>
        </div>
      </Card>
    </FlowScreen>
  );
}
