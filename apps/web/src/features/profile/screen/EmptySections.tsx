import styles from "./ProfileScreen.module.css";

/**
 * The design's sections (39) in their empty state (PS-R2, Q5): the layout is the design's, but
 * there are no habits, stages, seasons or graduations to show yet, so nothing is invented and no
 * endpoint that does not exist is called.
 */
export function EmptySections() {
  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tus hábitos</h2>
        <p className={styles.note}>
          Aún no hay hábitos. Los verás aquí cuando tu círculo empiece una temporada.
        </p>
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Temporadas</h2>
        <p className={styles.note}>Aún no hay temporadas. Las que cierres aparecerán aquí.</p>
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Consistencia histórica</h2>
        <p className={styles.note}>Aún sin datos. La verás cuando cierres tu primera temporada.</p>
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Hábitos graduados</h2>
        <p className={styles.note}>
          Aún ninguno. Graduar es decisión tuya, al cerrar una temporada.
        </p>
      </section>
    </>
  );
}
