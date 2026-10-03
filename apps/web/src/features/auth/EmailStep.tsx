import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../ui/Button.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { authMessage } from "./auth-messages.ts";
import styles from "./LoginLayout.module.css";
import { useSession } from "./session-context.tsx";

/** Deliberately loose: the server decides what a real address is; this only blocks obvious typos. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailStep() {
  const { notice, requestCode } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    setFailure(undefined);
    if (!EMAIL_SHAPE.test(address)) {
      setFieldError("Escribe un correo válido.");
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    try {
      await requestCode(address);
      navigate("/login/code", { state: { email: address } });
    } catch (error) {
      setFailure(authMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div>
        <h1 className={styles.heading}>Entrar</h1>
        <p className={styles.lead}>Te enviamos un código a tu correo. No necesitas contraseña.</p>
      </div>
      {notice === "sessionExpired" && (
        <InlineMessage tone="info" title="Tu sesión expiró. Entra de nuevo." />
      )}
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          label="Correo"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          {...(fieldError === undefined ? {} : { error: fieldError })}
        />
        {failure !== undefined && <InlineMessage tone="error" title={failure} />}
        <Button type="submit" block disabled={busy}>
          Enviar código
        </Button>
      </form>
    </>
  );
}
