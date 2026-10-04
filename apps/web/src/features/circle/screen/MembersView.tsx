import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import { Avatar } from "../../../ui/Avatar.tsx";
import { Badge } from "../../../ui/Badge.tsx";
import { Card } from "../../../ui/Card.tsx";
import styles from "./CircleScreen.module.css";
import { seasonStatus } from "./season-status.ts";

type Circle = NonNullable<MyCircle["circle"]>;

/**
 * The circle with people in it (design 31a-lite): who is in, the season and pact state, and the way
 * to invite. No habit summaries, feed, reactions or nudges (Q7): those are A3.
 */
export function MembersView({
  circle,
  season,
}: {
  readonly circle: Circle;
  readonly season: MyCircle["season"];
}) {
  const status = season === null ? null : seasonStatus(season, circle.members.length);
  return (
    <>
      <Card>
        <ul className={styles.members}>
          {circle.members.map((member) => (
            <li key={member.id} className={styles.member}>
              <Avatar name={member.displayName} size="xl" />
              <span className={styles.memberName}>{member.isYou ? "Tú" : member.displayName}</span>
            </li>
          ))}
        </ul>
      </Card>
      {status === null ? (
        <p className={styles.small}>
          Todavía no hay temporada. Cuando el círculo cree una, la verás aquí.
        </p>
      ) : (
        <div className={styles.status}>
          <Badge tone={status.tone} icon="handshake">{status.badge}</Badge>
          {status.detail !== null && <span className={styles.small}>{status.detail}</span>}
        </div>
      )}
    </>
  );
}
