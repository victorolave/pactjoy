import type { ReactNode } from "react";
import { longDate } from "../../../shared/format.ts";
import { TodayDateContext } from "../../../shared/today-date-context.tsx";
import { ButtonLink } from "../../../ui/ButtonLink.tsx";
import { Card } from "../../../ui/Card.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import { EntrySheetHost } from "../../entry/index.ts";
import { PendingYesterday } from "../pending-yesterday/PendingYesterday.tsx";
import { RowWithControls } from "../rows/RowWithControls.tsx";
import { SeasonCard } from "../season/SeasonCard.tsx";
import { StandingsPair } from "../season/StandingsPair.tsx";
import type { TodayModel } from "../today-view-model.ts";
import { allDoneDetail } from "./all-done-copy.ts";
import { dayOffText } from "./day-off-copy.ts";
import styles from "./TodayScreen.module.css";

type PactOpenModel = Extract<TodayModel, { kind: "pactOpen" }>;
type NotStartedModel = Extract<TodayModel, { kind: "notStarted" }>;
type RunningModel = Extract<TodayModel, { kind: "active" | "ended" }>;

/** Copy here is placeholder (P8) except where the design has wording. */
function Empty({
  title,
  alt,
  children,
}: {
  readonly title: string;
  readonly alt: string;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.empty}>
      <Illustration alt={alt} />
      <h1 className={styles.emptyTitle}>{title}</h1>
      {children}
    </section>
  );
}

export function NoCircle() {
  return (
    <Empty title="Aún no estás en un círculo" alt="Sin círculo todavía">
      <p className={styles.lead}>Cuando te unas a uno, tus compromisos de hoy aparecerán aquí.</p>
      <ButtonLink to="/circle/new">Crear o unirme a un círculo</ButtonLink>
    </Empty>
  );
}

export function NoSeason({ circleName }: { readonly circleName: string }) {
  return (
    <Empty title="Todavía no hay temporada" alt="Sin temporada todavía">
      <p className={styles.meta}>{circleName}</p>
      <p className={styles.lead}>Cuando el círculo cree una, la verás aquí.</p>
    </Empty>
  );
}

export function PactOpen({ model }: { readonly model: PactOpenModel }) {
  return (
    <Empty title="El pacto sigue abierto" alt="Pacto abierto">
      <p className={styles.meta}>{model.circleName}</p>
      <p className={styles.lead}>Temporada de {model.lengthWeeks} semanas</p>
      <p className={styles.lead}>Empieza el {longDate(model.startDate, false)}</p>
      <p className={styles.lead}>Falta que todos aprueben el pacto para empezar.</p>
      <ButtonLink to={`/season/${model.seasonId}/pact`}>Preparar la temporada</ButtonLink>
    </Empty>
  );
}

export function NotStarted({ model }: { readonly model: NotStartedModel }) {
  const countdown =
    model.daysUntilStart === 1
      ? "Empieza mañana"
      : `La temporada empieza en ${model.daysUntilStart} días`;
  return (
    <section className={styles.empty}>
      <header className={styles.header}>
        <div className={styles.meta}>{longDate(model.today)}</div>
        <h1 className={styles.title}>Hola</h1>
      </header>
      <Card>
        <div className={styles.preSeasonCard}>
          <div className={styles.meta}>Pacto cerrado con {model.circleName}</div>
          <div className={styles.countdownTitle}>{countdown}</div>
          <div className={styles.meta}>
            {longDate(model.startDate)} · {model.lengthWeeks} semanas
          </div>
        </div>
      </Card>
      {model.myCommitments.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Tu primera semana</h2>
          <Card>
            <div className={styles.commitmentList}>
              {model.myCommitments.map((c) => (
                <div key={c.id} className={styles.commitmentRow}>
                  <b>{c.habitName}</b>
                  <span className={styles.meta}>{c.maxPoints} pts</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      <p className={styles.lead}>
        Los registros se abren el {longDate(model.startDate, false)}. Hasta entonces no hay nada que
        hacer.
      </p>
    </section>
  );
}

function RunningHeader({ model }: { readonly model: RunningModel }) {
  const subtitle =
    model.kind === "ended"
      ? null
      : model.dayState === "allDone"
        ? "Hoy ya está cumplido."
        : model.dayState === "allLogged"
          ? "Hoy ya registraste todo."
          : model.dayState === "pending"
            ? "¿Qué quieres cumplir hoy?"
            : null;
  return (
    <header className={styles.header}>
      <div className={styles.meta}>
        {model.dateLabel} · {model.weekLabel}
      </div>
      <h1 className={styles.title}>
        {model.greetingName === null ? "Hola" : `Hola, ${model.greetingName}`}
      </h1>
      {subtitle !== null && <p className={styles.lead}>{subtitle}</p>}
    </header>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  readonly title: string;
  readonly meta?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </div>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

function AllDone({ model }: { readonly model: RunningModel }) {
  const logged = model.sections.forToday.filter((row) => row.opportunity.state === "logged");
  // Only real dones and quantities are celebrated; a day with a "Hoy no salió" is just registered.
  const achieved = model.dayState === "allDone";
  return (
    <Card tone={achieved ? "success" : "sunken"}>
      <div className={styles.allDone}>
        <span className={achieved ? styles.allDoneGlyph : styles.allLoggedGlyph}>
          <Icon name={achieved ? "check" : "minus"} />
        </span>
        <div>
          <div className={styles.allDoneTitle}>
            {model.counts.logged} de {model.counts.scheduled} compromisos de hoy
            {achieved ? "" : " registrados"}
          </div>
          <div className={styles.lead}>
            {allDoneDetail(logged, model.refDate, model.pointsToday)}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** A day with nothing scheduled (design 15c): the cooking illustration at 130 and where the week stands. */
function NoCommitments({ model }: { readonly model: RunningModel }) {
  const text = dayOffText(model.sections.week, model.sections.otherDays, model.refDate);
  return (
    <Card tone="warm">
      <div className={styles.dayOff}>
        <Illustration
          name="cocinar"
          size="md"
          alt="Una persona prepara una ensalada en la cocina"
        />
        <h2 className={styles.sectionTitle}>Hoy no tienes compromisos previstos.</h2>
        <p className={styles.lead}>
          {text === "" ? "Lo que queda de la semana sigue disponible abajo." : text}
        </p>
      </div>
    </Card>
  );
}

export function RunningToday({ model }: { readonly model: RunningModel }) {
  const { forToday, otherDays, week } = model.sections;
  const showDayState = model.kind === "active";
  return (
    <TodayDateContext.Provider value={{ today: model.today, refDate: model.refDate }}>
      <RunningHeader model={model} />
      {model.kind === "ended" && (
        <InlineMessage tone="info" title="Temporada terminada">
          Los registros abiertos solo se pueden ajustar mientras dure su plazo.
        </InlineMessage>
      )}
      {showDayState && (model.dayState === "allDone" || model.dayState === "allLogged") && (
        <AllDone model={model} />
      )}
      {showDayState && model.dayState === "none" && <NoCommitments model={model} />}
      <PendingYesterday
        items={model.pendingYesterday}
        registered={model.yesterdayRegistered}
        seasonId={model.seasonId}
      />
      {forToday.length > 0 && (
        <Section
          title={model.kind === "ended" ? "Último día" : "Para hoy"}
          meta={
            model.counts.scheduled > 0
              ? `${model.counts.logged} de ${model.counts.scheduled} registrados`
              : undefined
          }
        >
          {forToday.map((row) => (
            <RowWithControls key={row.commitmentId} row={row} seasonId={model.seasonId} />
          ))}
        </Section>
      )}
      {(week.length > 0 || otherDays.length > 0) && (
        <Section title="Esta semana">
          {[...week, ...otherDays].map((row) => (
            <RowWithControls key={row.commitmentId} row={row} seasonId={model.seasonId} />
          ))}
        </Section>
      )}
      <SeasonCard model={model.season} />
      {model.standings !== null && (
        <StandingsPair model={model.standings} viewerName={model.greetingName} />
      )}
      <EntrySheetHost
        rows={model.sheetRows}
        seasonId={model.seasonId}
        pendingYesterday={model.pendingYesterday}
      />
    </TodayDateContext.Provider>
  );
}
