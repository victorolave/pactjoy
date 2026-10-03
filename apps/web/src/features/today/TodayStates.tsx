import type { ReactNode } from "react";
import { longDate } from "../../shared/format.ts";
import { Illustration } from "../../ui/Placeholder.tsx";
import styles from "./TodayScreen.module.css";
import type { TodayModel } from "./today-view-model.ts";

type SeasonModel = Extract<TodayModel, { kind: "pactOpen" | "notStarted" }>;
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

export function PactOpen({ model }: { readonly model: SeasonModel }) {
  return (
    <Empty title="El pacto sigue abierto" alt="Pacto abierto">
      <p className={styles.meta}>{model.circleName}</p>
      <p className={styles.lead}>Temporada de {model.lengthWeeks} semanas</p>
      <p className={styles.lead}>Empieza el {longDate(model.startDate, false)}</p>
      <p className={styles.lead}>Falta que todos aprueben el pacto para empezar.</p>
    </Empty>
  );
}

export function NotStarted({ model }: { readonly model: SeasonModel }) {
  return (
    <Empty title="Tu temporada aún no empieza" alt="Temporada por empezar">
      <p className={styles.meta}>{model.circleName}</p>
      <p className={styles.lead}>Empieza el {longDate(model.startDate, false)}.</p>
    </Empty>
  );
}

export function RunningHeader({ model }: { readonly model: RunningModel }) {
  return (
    <header className={styles.header}>
      <div className={styles.meta}>
        {model.dateLabel} · {model.weekLabel}
      </div>
      <h1 className={styles.title}>
        {model.greetingName === null ? "Hola" : `Hola, ${model.greetingName}`}
      </h1>
    </header>
  );
}
