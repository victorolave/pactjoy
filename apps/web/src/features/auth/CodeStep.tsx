import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { Button } from "../../ui/Button.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { authMessage } from "./auth-messages.ts";
import styles from "./LoginLayout.module.css";
import { useSession } from "./session-context.tsx";

const CODE_SHAPE = /^\d{6}$/;

const emailFrom = (state: unknown): string | null => {
  if (typeof state !== "object" || state === null || !("email" in state)) return null;
  return typeof state.email === "string" && state.email !== "" ? state.email : null;
};

export function CodeStep() {
  const email = emailFrom(useLocation().state);
  // The email travels in router state: without it (a reload, a pasted link) start over.
  return email === null ? <Navigate to="/login" replace /> : <CodeForm email={email} />;
}

function CodeForm({ email }: { readonly email: string }) {
  const { verifyCode, requestCode } = useSession();
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(undefined);
    setResent(false);
    if (!CODE_SHAPE.test(code)) {
      setFieldError("El código tiene 6 dígitos.");
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    try {
      // On success the session changes and the guard sends the user to Today.
      await verifyCode(email, code);
    } catch (error) {
      setFailure(authMessage(error));
      setBusy(false);
    }
  };

  const resend = async () => {
    setFailure(undefined);
    setResent(false);
    try {
      await requestCode(email);
      setResent(true);
    } catch (error) {
      setFailure(authMessage(error));
    }
  };

  return (
    <>
      <div>
        <h1 className={styles.heading}>Escribe tu código</h1>
        <p className={styles.lead}>Lo enviamos a {email}.</p>
      </div>
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          label="Código"
          hint="Seis dígitos"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          {...(fieldError === undefined ? {} : { error: fieldError })}
        />
        {failure !== undefined && <InlineMessage tone="error" title={failure} />}
        {resent && <InlineMessage tone="success" title="Te enviamos un código nuevo." />}
        <Button type="submit" block disabled={busy}>
          Entrar
        </Button>
      </form>
      <div className={styles.links}>
        <Button variant="ghost" onClick={resend}>
          Reenviar código
        </Button>
        <Link to="/login" className="pj-btn pj-btn--ghost">
          Cambiar correo
        </Link>
      </div>
    </>
  );
}
