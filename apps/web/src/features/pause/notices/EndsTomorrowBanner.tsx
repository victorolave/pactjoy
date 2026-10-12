import type { TodayRow } from "@pactjoy/app";
import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { addDays } from "../../../shared/date.ts";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { usePauseContext } from "../pause-context.ts";
import { commitmentList } from "../pause-format.ts";
import { RequestPauseSheet } from "../request/RequestPauseSheet.tsx";
import { ResumeSheet } from "../resume/ResumeSheet.tsx";
import styles from "./EndsTomorrowBanner.module.css";

type Pause = NonNullable<TodayRow["pause"]>;

interface Group {
  readonly pause: Pause;
  readonly rows: readonly TodayRow[];
}

/** Rows whose approved pause ends tomorrow, one group per request ("Todos" is one request). */
function groupsOf(rows: readonly TodayRow[]): Group[] {
  const groups = new Map<string, { pause: Pause; rows: TodayRow[] }>();
  for (const row of rows) {
    const { pause } = row;
    if (pause === null || !pause.endsTomorrow || pause.status !== "approved") continue;
    const group = groups.get(pause.pauseRequestId) ?? { pause, rows: [] };
    group.rows.push(row);
    groups.set(pause.pauseRequestId, group);
  }
  return [...groups.values()];
}

function Banner({ group }: { readonly group: Group }) {
  const online = useOnline();
  const { season } = usePauseContext();
  const [dialog, setDialog] = useState<"resume" | "more" | null>(null);
  const close = () => setDialog(null);
  const { pause, rows } = group;
  const names = commitmentList(rows.map((row) => row.habitName));
  const only = rows.length === 1 ? rows[0] : undefined;

  // A fixed end can be followed by another request starting the day after; an open pause that hits
  // its cap tomorrow has no days left to ask for (Q12).
  const nextStart = pause.endDate === null ? null : addDays(pause.endDate, 1);
  const canAskMore = nextStart !== null && season !== null && nextStart <= season.lastDay;

  return (
    <>
      <InlineMessage
        tone="info"
        title={
          pause.endDate === null
            ? `Tu pausa de ${names} llega mañana al máximo de días`
            : `Tu pausa de ${names} termina mañana`
        }
        action={
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!online}
              onClick={() => setDialog("resume")}
            >
              Reanudar
            </Button>
            {canAskMore && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!online}
                onClick={() => setDialog("more")}
              >
                Pedir más días
              </Button>
            )}
          </div>
        }
      >
        {pause.endDate === null
          ? "Después vuelve a contar con normalidad."
          : "Puedes reanudar ya o pedir más días."}
      </InlineMessage>
      <ResumeSheet
        open={dialog === "resume"}
        onClose={close}
        pauseRequestId={pause.pauseRequestId}
        commitmentId={only?.commitmentId}
        subject={only === undefined ? "tus compromisos" : only.habitName}
      />
      {canAskMore && (
        <RequestPauseSheet
          open={dialog === "more"}
          onClose={close}
          initialStart={nextStart}
          {...(only === undefined ? {} : { initialCommitmentId: only.commitmentId })}
        />
      )}
    </>
  );
}

/**
 * Screen 30a: Today's notice the day before an approved pause ends (PS-13). The server decides
 * `endsTomorrow`; this only shows it, once per request. Never for a pending request, which the
 * server never flags.
 */
export function EndsTomorrowBanner({ rows }: { readonly rows: readonly TodayRow[] }) {
  return groupsOf(rows).map((group) => <Banner key={group.pause.pauseRequestId} group={group} />);
}
