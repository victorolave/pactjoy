import { Avatar } from "../../../ui/Avatar.tsx";
import { Icon, type IconName } from "../../../ui/icon/Icon.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import styles from "./GoalsIllustration.module.css";

interface Goal {
  readonly icon: IconName;
  readonly label: string;
  readonly tint: "orange" | "coral" | "pink" | "purple";
}

interface Person {
  readonly name: "Andrea" | "Victor";
  readonly picture: "metas-andrea" | "metas-victor";
  readonly goals: readonly Goal[];
}

/** Design 1b, copied as drawn. Andrea and Victor are the fictional example people. */
const PEOPLE: readonly Person[] = [
  {
    name: "Andrea",
    picture: "metas-andrea",
    goals: [
      { icon: "footprints", label: "Correr", tint: "orange" },
      { icon: "flower-2", label: "Meditar", tint: "coral" },
      { icon: "coffee", label: "Cafés", tint: "pink" },
      { icon: "eye-off", label: "Privado", tint: "purple" },
    ],
  },
  {
    name: "Victor",
    picture: "metas-victor",
    goals: [
      { icon: "book-open", label: "Leer", tint: "orange" },
      { icon: "brain", label: "Inglés", tint: "coral" },
      { icon: "dumbbell", label: "Gym", tint: "pink" },
      { icon: "palette", label: "Dibujar", tint: "purple" },
    ],
  },
];

export const GOALS_ALT = "Las metas de dos personas, cada una con sus compromisos";

/**
 * Welcome slide 1b: two season cards, each with a person's picture overhanging it. It is one
 * picture for assistive tech; the names and numbers inside are example data, so they are hidden.
 */
export function GoalsIllustration() {
  return (
    <div className={styles.stack} role="img" aria-label={GOALS_ALT}>
      {PEOPLE.map((person) => (
        <div key={person.name} className={styles.row} data-person={person.name}>
          <div className={styles.card} aria-hidden="true">
            <div className={styles.header}>
              <Avatar name={person.name} size="xs" />
              <b className={styles.name}>{person.name}</b>
            </div>
            <div className={styles.points}>1.000 pts</div>
            <div className={styles.goals}>
              {person.goals.map((goal) => (
                <span key={goal.label} className={styles.goal} data-tint={goal.tint}>
                  <Icon name={goal.icon} size="xs" />
                  {goal.label}
                </span>
              ))}
            </div>
          </div>
          <div className={styles.picture} aria-hidden="true">
            <Illustration alt="" name={person.picture} />
          </div>
        </div>
      ))}
    </div>
  );
}
