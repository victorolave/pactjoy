import { ButtonLink } from "../../../ui/ButtonLink.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import styles from "./CircleScreen.module.css";

/** No circle yet (design 31b): the two ways in, create or join with a code. */
export function EmptyCircle() {
  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>Círculo</h1>
      <div className={styles.empty}>
        <Illustration
          name="invitar-circulo"
          size="hero"
          alt="Tres personas conversan unidas por una cinta de color"
        />
        <h2 className={styles.emptyTitle}>Tu círculo empieza aquí.</h2>
        <p className={styles.lead}>
          Crea un círculo o únete con el código de quien te invitó. De 1 a 6 personas.
        </p>
        <div className={styles.actions}>
          <ButtonLink to="/circle/new">Crear círculo</ButtonLink>
          <ButtonLink to="/circle/join" variant="ghost">
            Tengo un código
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
