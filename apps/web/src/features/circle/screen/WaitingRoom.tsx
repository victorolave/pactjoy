import { useId } from "react";
import { useNavigate } from "react-router";
import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import { Avatar } from "../../../ui/Avatar.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import { Tag } from "../../../ui/Tag.tsx";
import { InviteStrip } from "../invite/InviteStrip.tsx";
import styles from "./CircleScreen.module.css";

type Circle = NonNullable<MyCircle["circle"]>;

/** A call to action that arrives with Lote 3: visible, disabled and labelled (Q4, WC-S8). */
function ComingSoon({
  variant,
  children,
}: {
  readonly variant?: "ghost";
  readonly children: string;
}) {
  // A disabled button is skipped by many screen readers, so the tag is also its description.
  const tagId = useId();
  return (
    <div className={styles.soon}>
      <Button
        {...(variant === undefined ? {} : { variant })}
        block
        disabled
        aria-describedby={tagId}
      >
        {children}
      </Button>
      <span id={tagId} className={styles.soonTag}>
        <Tag>Próximamente</Tag>
      </span>
    </div>
  );
}

/**
 * The viewer alone in the circle (design 7). It does not promise a notification: the tab looks for
 * a second member by itself (WC-R8). A solo circle is valid, so nothing here says it is incomplete.
 */
export function WaitingRoom({ circle }: { readonly circle: Circle }) {
  const navigate = useNavigate();
  const me = circle.members[0]?.displayName ?? "";
  return (
    <>
      <Illustration
        name="primer-habito"
        size="hero"
        alt="Una mujer piensa con un cuaderno en la mano"
      />
      <div className={styles.avatars}>
        <Avatar name={me} size="xl" />
        <span className={styles.slot}>
          <Icon name="plus" />
        </span>
      </div>
      <div>
        <h2 className={styles.emptyTitle}>Esperando a que alguien se una</h2>
        <p className={styles.lead}>
          Comparte el código con quien quieras. Esta pantalla se actualiza sola cuando alguien
          entre. Mientras tanto, puedes preparar la temporada y tus hábitos.
        </p>
      </div>
      <InviteStrip circleId={circle.id} invite={circle.invite} />
      <Button block onClick={() => navigate("/season/new")}>
        Preparar la temporada
      </Button>
      <ComingSoon variant="ghost">Solo crear mis hábitos</ComingSoon>
    </>
  );
}
