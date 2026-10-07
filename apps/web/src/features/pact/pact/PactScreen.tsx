import type { MeasureView } from "@pactjoy/app";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useDeviceStore } from "../../../context/device-store-context.tsx";
import { ApiError } from "../../../ports/api-error.ts";
import type { CommitmentDto, Serialized } from "../../../ports/wire.ts";
import { addDays } from "../../../shared/date.ts";
import { weekdayDay } from "../../../shared/format.ts";
import { scheduleText, targetText } from "../../../shared/row-labels.ts";
import { Avatar, AvatarStack } from "../../../ui/Avatar.tsx";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { pactFlow, viewerMemberId } from "../pact-flow.ts";
import { useApprovePact, useCurrentCircle, useSeason, useWithdrawApproval } from "../queries.ts";
import styles from "./PactScreen.module.css";

const SHORT_MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

function formatShortDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const day = Number(match[3]);
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  return month ? `${day} ${month}` : isoDate;
}

function formatDateRange(startDate: string, lengthWeeks: number): string {
  const endDate = addDays(startDate, lengthWeeks * 7 - 1);
  return `${formatShortDate(startDate)} – ${formatShortDate(endDate)}`;
}

function formatMeasureDetail(measure: Serialized<MeasureView>): string {
  const sched = scheduleText(measure);
  const target = targetText(measure) ?? (measure.unit === "done" ? "hecho / no hecho" : null);
  return [sched, target].filter(Boolean).join(" · ");
}

export function PactScreen() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const navigate = useNavigate();
  const deviceStore = useDeviceStore();

  const seasonQuery = useSeason(seasonId);
  const circleQuery = useCurrentCircle();
  const approveMutation = useApprovePact();
  const withdrawMutation = useWithdrawApproval();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  if (seasonQuery.isLoading || circleQuery.isLoading) {
    return (
      <FlowScreen title="Revisión del pacto" onBack={() => navigate(-1)}>
        <div className={styles.section} aria-busy="true">
          <Skeleton shape="line" lines={4} />
        </div>
      </FlowScreen>
    );
  }

  const season = seasonQuery.data;
  const circleData = circleQuery.data;
  const circle = circleData?.circle;

  if (!season || !circleData || !circle || seasonQuery.isError || circleQuery.isError) {
    return (
      <FlowScreen title="Revisión del pacto" onBack={() => navigate(-1)}>
        <div role="alert" className={styles.section}>
          <p className={styles.lead}>No pudimos cargar el pacto.</p>
          <Button
            onClick={() => {
              void seasonQuery.refetch();
              void circleQuery.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
      </FlowScreen>
    );
  }

  const viewerId = viewerMemberId(circleData);
  const closedSeen = Boolean(deviceStore.get(`pact-closed-seen:${season.id}`));
  const screenKind = viewerId ? pactFlow(season, viewerId, closedSeen) : "review";

  if (screenKind === "today") {
    return <Navigate to="/" replace />;
  }

  const startDate = season.actualStart ?? season.nominalStart;
  const otherMembers = circle.members.filter((m) => m.id !== viewerId);
  const otherNames = otherMembers.map((m) => m.displayName).join(", ") || "tu círculo";

  // 14a Pact Closed celebration
  if (screenKind === "closed") {
    const startFormatted = weekdayDay(startDate)?.toLowerCase() ?? startDate;
    const celebrationLead =
      otherMembers.length === 0
        ? `Empiezas el ${startFormatted}. Con tus metas para esta temporada.`
        : `${otherNames} y tú empiezan el ${startFormatted}. Cada uno con sus metas, ${
            otherMembers.length === 1 ? "los dos" : "todos"
          } en la misma temporada.`;

    const handleContinue = () => {
      deviceStore.set(`pact-closed-seen:${season.id}`, "1");
      navigate("/");
    };

    return (
      <div className={styles.celebration}>
        <div className={styles.celebrationDecor} aria-hidden="true">
          <div className={styles.ribbon} />
          <div className={`${styles.particle} ${styles.pCircle} ${styles.p1}`} />
          <div className={`${styles.particle} ${styles.pSquare1} ${styles.p2}`} />
          <div className={`${styles.particle} ${styles.pCircle} ${styles.p3}`} />
          <div className={`${styles.particle} ${styles.pSquare2} ${styles.p4}`} />
          <div className={`${styles.particle} ${styles.pCircle} ${styles.p5}`} />
          <div className={`${styles.particle} ${styles.pSquare3} ${styles.p6}`} />
        </div>
        <div className={styles.celebrationBody}>
          <div className={styles.emoji}>🤝</div>
          <h1 className={styles.celebrationTitle}>Pacto cerrado</h1>
          <p className={styles.celebrationLead}>{celebrationLead}</p>
          <div className={styles.celebrationMeta}>
            <AvatarStack names={circle.members.map((m) => m.displayName)} size="sm" />
            <span>{`${season.commitments.length} compromisos · ${season.lengthWeeks} semanas`}</span>
          </div>
        </div>
        <div className={styles.celebrationFooter}>
          <Button variant="inverse" block onClick={handleContinue}>
            Continuar
          </Button>
        </div>
      </div>
    );
  }

  // 12b Waiting screen
  if (screenKind === "waiting") {
    const handleWithdraw = async () => {
      try {
        setErrorMessage(null);
        setIsMutating(true);
        await withdrawMutation.mutateAsync({ seasonId: season.id });
      } catch {
        setErrorMessage("No pudimos retirar la aprobación. Inténtalo de nuevo.");
      } finally {
        setIsMutating(false);
      }
    };

    const startFormatted = weekdayDay(startDate)?.toLowerCase() ?? startDate;

    return (
      <FlowScreen title={`Esperando a ${otherNames}`}>
        <div className={styles.section}>
          <AvatarStack names={circle.members.map((m) => m.displayName)} size="md" />
          <div>
            <p className={styles.lead}>
              Aprobaste el pacto. Cuando {otherNames} lo apruebe, quedará cerrado y te avisaremos.
            </p>
          </div>
          <Card>
            <div className={styles.cardInner}>
              {circle.members.map((member) => {
                const isApproved = season.approvals.some((a) => a.memberId === member.id);
                return (
                  <div key={member.id} className={styles.statusRow}>
                    <Avatar name={member.displayName} size="sm" />
                    <span className={styles.statusName}>
                      {member.id === viewerId ? "Tú" : member.displayName}
                    </span>
                    <Badge
                      tone={isApproved ? "success" : "pending"}
                      {...(isApproved ? { icon: "check" as const } : {})}
                    >
                      {isApproved ? "Aprobado" : "Pendiente"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </Card>
          <p className={styles.lead}>
            Si {otherNames} aprueba después del {startFormatted}, la temporada empezará el día
            siguiente a su aprobación. Si alguien edita sus compromisos, las dos aprobaciones se
            reinician.
          </p>
          {errorMessage && <InlineMessage tone="error">{errorMessage}</InlineMessage>}
          <div className={styles.actions}>
            <Button
              variant="secondary"
              block
              disabled={isMutating}
              onClick={() => void handleWithdraw()}
            >
              Retirar mi aprobación
            </Button>
          </div>
        </div>
      </FlowScreen>
    );
  }

  // 12a Review screen
  const cadenceLabel =
    season.reviewCadenceWeeks === 1
      ? "revisión cada 1 semana"
      : `revisión cada ${season.reviewCadenceWeeks} semanas`;
  const metaLine = `${season.lengthWeeks} semanas · ${formatDateRange(startDate, season.lengthWeeks)} · ${cadenceLabel}`;

  const sortedMembers = [...circle.members].sort((a, b) => {
    if (a.id === viewerId) return -1;
    if (b.id === viewerId) return 1;
    return 0;
  });

  const handleApprove = async () => {
    try {
      setErrorMessage(null);
      setIsMutating(true);
      await approveMutation.mutateAsync({
        seasonId: season.id,
        expectedPactRevision: season.pactRevision,
      });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "StaleSeason" || err.status === 409)) {
        setErrorMessage("El pacto cambió. Revísalo de nuevo.");
        try {
          await seasonQuery.refetch();
        } catch {
          // ignore
        }
      } else {
        setErrorMessage("No pudimos aprobar el pacto. Inténtalo de nuevo.");
      }
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <FlowScreen
      title="Revisa el pacto antes de aceptar"
      meta={metaLine}
      onBack={() => navigate(-1)}
    >
      <div className={styles.section}>
        <p className={styles.lead}>
          Cada uno persigue sus propias metas. Durante la temporada no se podrán editar; solo
          pausar.
        </p>

        {sortedMembers.map((member) => {
          const isApproved = season.approvals.some((a) => a.memberId === member.id);
          const memberCommitments = season.commitments.filter((c) => c.memberId === member.id);
          const isYou = member.id === viewerId;

          return (
            <div key={member.id} className={styles.memberGroup}>
              <div className={styles.memberHeader}>
                <Avatar name={member.displayName} size="sm" />
                <span className={styles.memberTitle}>
                  {isYou ? "Tus compromisos" : member.displayName}
                </span>
                <Badge
                  tone={isApproved ? "success" : "pending"}
                  {...(isApproved ? { icon: "check" as const } : {})}
                >
                  {isApproved ? "Aprobado" : "Pendiente"}
                </Badge>
              </div>
              <Card>
                <div className={styles.cardInner}>
                  {memberCommitments.map((c: CommitmentDto) => {
                    const isPrivate = c.kind === "hidden" || c.privacy === "private";
                    const isHiddenOther = c.kind === "hidden";
                    const name = isHiddenOther ? "Meta privada" : (c.habit?.name ?? "Hábito");
                    const detail = isHiddenOther
                      ? `Solo ${member.displayName} ve los detalles`
                      : formatMeasureDetail(c.measure);
                    const privacyTag = isPrivate ? "Privado" : "Visible";

                    return (
                      <div key={c.id} className={styles.commitmentRow}>
                        <div className={styles.commitmentInfo}>
                          <div className={styles.commitmentName}>{name}</div>
                          <div className={styles.commitmentDetail}>{detail}</div>
                          <div className={styles.commitmentPrivacy}>{privacyTag}</div>
                        </div>
                        <span className={styles.commitmentWeight}>{c.weightPercent} %</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          );
        })}

        {errorMessage && <InlineMessage tone="error">{errorMessage}</InlineMessage>}

        <div className={styles.actions}>
          <Button
            block
            leadingIcon="handshake"
            disabled={isMutating}
            onClick={() => void handleApprove()}
          >
            Aprobar el pacto
          </Button>
          <Button
            variant="secondary"
            block
            leadingIcon="pencil"
            disabled={isMutating}
            onClick={() => navigate(`/season/${season.id}/habits`)}
          >
            Editar mis compromisos
          </Button>
          <p className={styles.footnote}>
            Mientras el pacto no esté cerrado, cada uno puede editar sus compromisos. Cualquier
            cambio reinicia todas las aprobaciones.
          </p>
        </div>
      </div>
    </FlowScreen>
  );
}
