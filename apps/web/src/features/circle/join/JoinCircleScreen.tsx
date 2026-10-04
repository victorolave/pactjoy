import { type FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../../ports/api-error.ts";
import type { InvitePreviewView } from "../../../ports/pactjoy-api.ts";
import { Avatar } from "../../../ui/Avatar.tsx";
import { Button } from "../../../ui/Button.tsx";
import { ButtonLink } from "../../../ui/ButtonLink.tsx";
import { Card } from "../../../ui/Card.tsx";
import { CodeInput } from "../../../ui/CodeInput.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { displayNameProblem, useNameDraft } from "../../onboarding/index.ts";
import {
  ALREADY_IN_THIS_CIRCLE,
  type CircleFailure,
  CODE_CHARS_HINT,
  circleFailure,
} from "../circle-messages.ts";
import { useInvitePreview, useJoinCircle, useMyCircle } from "../queries.ts";
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from "./invite-code.ts";
import styles from "./JoinCircleScreen.module.css";

/** Where a new member lands: their circle (Today shows the open pact, Q8). */
const CIRCLE_PATH = "/circle";
/** Where "Tengo un código" came from when there is no history to go back to. */
const CREATE_PATH = "/circle/new";
const CODE_MESSAGE_ID = "join-code-message";

/** "Te invita Andrea · 2 miembros", or just the count when the inviter is gone (IP-R3). */
function previewLine(preview: InvitePreviewView): string {
  const count = `${preview.activeMemberCount} ${preview.activeMemberCount === 1 ? "miembro" : "miembros"}`;
  return preview.invitedBy === null ? count : `Te invita ${preview.invitedBy} · ${count}`;
}

/**
 * Design 6a and 6b. Typing or pasting 6 characters previews the circle (a read-only call with the
 * same rules as joining, so what is shown is what will happen); "Unirme" then joins. The member's
 * displayName starts from the device's name draft and stays editable.
 */
export function JoinCircleScreen() {
  const { draft } = useNameDraft();
  const navigate = useNavigate();
  const location = useLocation();
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState(draft ?? "");
  const [nameError, setNameError] = useState<string | undefined>();
  const [joinError, setJoinError] = useState<unknown>(null);
  const preview = useInvitePreview(code);
  const myCircle = useMyCircle();
  const join = useJoinCircle();

  const error: unknown = joinError ?? (preview.isError ? preview.error : null);
  // The previewed circle is the viewer's own when it is the one the viewer's invite opens.
  const ownCircle = myCircle.data?.circle?.invite?.code === code;
  const failure: CircleFailure | null =
    error === null
      ? null
      : error instanceof ApiError && error.code === "AlreadyInActiveCircle" && ownCircle
        ? { message: ALREADY_IN_THIS_CIRCLE, field: null, retryable: false }
        : circleFailure(error);
  const message = failure !== null && failure.field !== "displayName" ? failure : null;
  const alreadyHere = message?.message === ALREADY_IN_THIS_CIRCLE;
  const previewFailed = joinError === null && preview.isError;

  const changeCode = (next: string) => {
    setCode(next);
    setJoinError(null);
    setNameError(undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview.isSuccess || join.isPending) return;
    const problem = displayNameProblem(displayName);
    setNameError(problem ?? undefined);
    if (problem !== null) return;
    setJoinError(null);
    try {
      await join.mutateAsync({ inviteCode: code, displayName: displayName.trim() });
      navigate(CIRCLE_PATH);
    } catch (caught) {
      const found = circleFailure(caught);
      if (found.field === "displayName") setNameError(found.message);
      else setJoinError(caught);
    }
  };

  return (
    <FlowScreen
      title="Únete con un código"
      onSubmit={submit}
      onBack={() => (location.key === "default" ? navigate(CREATE_PATH) : navigate(-1))}
      footer={
        <Button type="submit" block disabled={!preview.isSuccess || join.isPending}>
          Unirme al círculo
        </Button>
      }
    >
      <CodeInput
        label="Código de invitación"
        value={code}
        onChange={changeCode}
        alphabet={INVITE_CODE_ALPHABET}
        length={INVITE_CODE_LENGTH}
        rejectedHint={CODE_CHARS_HINT}
        invalid={failure?.field === "code"}
        describedBy={message === null ? undefined : CODE_MESSAGE_ID}
      />
      {message !== null && (
        <div id={CODE_MESSAGE_ID}>
          <InlineMessage
            tone="error"
            title={message.message}
            {...(alreadyHere
              ? {
                  action: (
                    <ButtonLink to={CIRCLE_PATH} variant="ghost" size="sm">
                      Ir al círculo
                    </ButtonLink>
                  ),
                }
              : previewFailed && message.retryable
                ? {
                    action: (
                      <Button variant="ghost" size="sm" onClick={() => preview.refetch()}>
                        Reintentar
                      </Button>
                    ),
                  }
                : {})}
          />
        </div>
      )}
      {code.length === INVITE_CODE_LENGTH && preview.isPending && (
        <div role="status">
          <span className={styles.visuallyHidden}>Buscando el círculo…</span>
          <Skeleton shape="card" />
        </div>
      )}
      {preview.isSuccess && (
        <>
          <Card>
            <div className={styles.preview}>
              <Avatar name={preview.data.invitedBy ?? preview.data.circleName} />
              <div className={styles.previewText}>
                <div className={styles.previewName}>{preview.data.circleName}</div>
                <div className={styles.previewMeta}>{previewLine(preview.data)}</div>
              </div>
            </div>
          </Card>
          <TextField
            label="Tu nombre en el círculo"
            hint="Así te verán los demás. Puedes cambiarlo después."
            autoComplete="given-name"
            enterKeyHint="done"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setNameError(undefined);
            }}
            {...(nameError === undefined ? {} : { error: nameError })}
          />
        </>
      )}
    </FlowScreen>
  );
}
