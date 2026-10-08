import { Navigate, useNavigate, useParams } from "react-router";
import { ApiError } from "../../ports/api-error.ts";
import { progressRoutes } from "../../shared/season-progress-routes.ts";
import { Button } from "../../ui/Button.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { useMemberProgress } from "../season-progress-data/index.ts";
import styles from "./MemberSeason.module.css";
import { MemberSeason, MemberSeasonFrame } from "./MemberSeason.tsx";

/**
 * Statuses where there is no such season of this member for the viewer (unknown, not theirs, a
 * malformed link): the overview is the honest destination, not a connection error.
 */
const NOT_VIEWABLE = new Set([400, 403, 404]);

/**
 * `/season/:seasonId/members/:memberId` (design 23d), opened by tapping a member in the
 * standings. The viewer's own season IS the overview, and a season that has not started has no
 * member view yet: both go to `/season`.
 */
export function MemberSeasonScreen() {
  const { seasonId = "", memberId = "" } = useParams();
  const navigate = useNavigate();
  const query = useMemberProgress(seasonId, memberId);
  const back = () => navigate(progressRoutes.overview);

  if (query.isPending) {
    return (
      <MemberSeasonFrame onBack={back}>
        <div className={styles.content} aria-busy="true">
          <Skeleton shape="line" lines={2} />
          <Skeleton shape="card" lines={2} />
        </div>
      </MemberSeasonFrame>
    );
  }

  if (query.isError) {
    if (query.error instanceof ApiError && NOT_VIEWABLE.has(query.error.status)) {
      return <Navigate to={progressRoutes.overview} replace />;
    }
    return (
      <MemberSeasonFrame onBack={back}>
        <div className={styles.failure} role="alert">
          <span className={styles.failureIcon}>
            <Icon name="cloud-off" size="lg" />
          </span>
          <p className={styles.failureTitle}>No pudimos cargar la temporada.</p>
          <p className={styles.failureBody}>Tus registros están a salvo. Inténtalo de nuevo.</p>
          <Button leadingIcon="rotate-cw" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </div>
      </MemberSeasonFrame>
    );
  }

  const view = query.data;
  if (view.state === "notStarted" || view.scope === "own") {
    return <Navigate to={progressRoutes.overview} replace />;
  }
  return <MemberSeason view={view} onBack={back} />;
}
