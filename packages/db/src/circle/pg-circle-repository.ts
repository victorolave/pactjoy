import {
  type Circle,
  type CircleRepository,
  ConcurrencyConflict,
  circleId,
  type Instant,
  inviteCode,
  type Member,
  memberId,
  userId,
} from "@pactjoy/app";
import type { BindMode, SqlExecutor } from "../client.ts";

interface CircleRow {
  id: string;
  name: string;
  created_at: Instant;
  archived_at: Instant | null;
  version: number;
}
interface MemberRow {
  id: string;
  user_id: string;
  display_name: string;
  status: "active" | "left";
  joined_at: Instant;
  left_at: Instant | null;
}
interface InviteRow {
  code: string;
  created_at: Instant;
  expires_at: Instant;
  created_by: string;
}

const iso = (at: Instant) => new Date(at).toISOString();
const isoOrNull = (at: Instant | null) => (at === null ? null : iso(at));

const CIRCLE_COLUMNS = "c.id, c.name, c.created_at, c.archived_at, c.version";

/**
 * One instance per transaction (see `bindRepositories`), so `preWrite` is that
 * transaction's own map: circle id -> the version it had BEFORE this transaction
 * first wrote it (`null` = inserted here, so there was nothing to guard).
 */
export function createPgCircleRepository(exec: SqlExecutor, mode: BindMode): CircleRepository {
  const preWrite = new Map<string, number | null>();

  /**
   * Torn reads: the three queries run at READ COMMITTED inside a write
   * transaction, so a concurrent commit between them can mix members of one
   * version with a root of another. The root is read FIRST, so such a commit
   * bumped the version past the one we hold: any transaction that guards or
   * saves this circle cannot commit (version-checked UPDATE, locked guard).
   * A use case that reads a circle without guarding or saving it gets no such
   * protection. This relies on every save bumping `version`. `read()` is one
   * snapshot, so it never tears.
   */
  async function load(row: CircleRow | undefined): Promise<Circle | null> {
    if (!row) return null;
    const members = await exec.query<MemberRow>(
      "select id, user_id, display_name, status, joined_at, left_at from pactjoy.circle_members where circle_id = $1 order by position",
      [row.id],
    );
    const invites = await exec.query<InviteRow>(
      "select code, created_at, expires_at, created_by from pactjoy.circle_invites where circle_id = $1",
      [row.id],
    );
    const invite = invites.rows[0];
    return {
      id: circleId(row.id),
      name: row.name,
      members: members.rows.map(
        (m): Member => ({
          id: memberId(m.id),
          userId: userId(m.user_id),
          displayName: m.display_name,
          status: m.status,
          joinedAt: m.joined_at,
          leftAt: m.left_at,
        }),
      ),
      invite: invite
        ? {
            code: inviteCode(invite.code),
            createdAt: invite.created_at,
            expiresAt: invite.expires_at,
            createdBy: memberId(invite.created_by),
          }
        : null,
      createdAt: row.created_at,
      archivedAt: row.archived_at,
      version: row.version,
    };
  }

  const one = async (where: string, params: unknown[]) =>
    load(
      (
        await exec.query<CircleRow>(
          `select ${CIRCLE_COLUMNS} from pactjoy.circles c ${where} order by c.created_at, c.id limit 1`,
          params,
        )
      ).rows[0],
    );

  return {
    get: (id) => one("where c.id = $1", [id]),
    findByInviteCode: (code) =>
      one("join pactjoy.circle_invites i on i.circle_id = c.id where i.code = $1", [code]),
    findActiveByUser: (user) =>
      one(
        "where exists (select 1 from pactjoy.circle_members m where m.circle_id = c.id and m.user_id = $1 and m.status = 'active')",
        [user],
      ),

    /**
     * Eager read-set guard. `FOR NO KEY UPDATE`, never FOR SHARE (two guards
     * upgrading to a write deadlock) and not FOR UPDATE (it would block the
     * KEY SHARE an FK check takes, e.g. a season insert). The lock lasts to
     * COMMIT, so the check is atomic with it. A circle this transaction already
     * wrote is compared against its pre-write version: the row is locked and
     * its stored version is already ours.
     */
    async guardVersion(id, expectedVersion) {
      if (mode === "read") return;
      if (preWrite.has(id)) {
        if (preWrite.get(id) !== expectedVersion) throw new ConcurrencyConflict();
        return;
      }
      const { rows } = await exec.query<{ version: number }>(
        "select version from pactjoy.circles where id = $1 for no key update",
        [id],
      );
      if (rows[0]?.version !== expectedVersion) throw new ConcurrencyConflict();
    },

    async save(circle, expectedVersion) {
      const first = !preWrite.has(circle.id);
      const root = [circle.id, circle.name, iso(circle.createdAt), isoOrNull(circle.archivedAt)];
      if (expectedVersion === null) {
        // A duplicate id raises 23505 on circles_pkey, which the unit of work maps to ConcurrencyConflict.
        await exec.query(
          "insert into pactjoy.circles (id, name, created_at, archived_at, version) values ($1, $2, $3::timestamptz, $4::timestamptz, $5)",
          [...root, circle.version],
        );
        if (first) preWrite.set(circle.id, null);
      } else {
        // Only mutable columns are SET: `id` is a key column (never SET, ADR-0010) and `created_at` never changes.
        const { rowCount } = await exec.query(
          "update pactjoy.circles set name = $2, archived_at = $3::timestamptz, version = $4 where id = $1 and version = $5",
          [circle.id, circle.name, isoOrNull(circle.archivedAt), circle.version, expectedVersion],
        );
        if (rowCount === 0) throw new ConcurrencyConflict();
        if (first) preWrite.set(circle.id, expectedVersion);
        await exec.query("delete from pactjoy.circle_members where circle_id = $1", [circle.id]);
        await exec.query("delete from pactjoy.circle_invites where circle_id = $1", [circle.id]);
      }
      if (circle.members.length > 0) {
        const values = circle.members.map((_, i) => {
          const n = i * 8;
          return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}::timestamptz, $${n + 8}::timestamptz)`;
        });
        await exec.query(
          `insert into pactjoy.circle_members (id, circle_id, position, user_id, display_name, status, joined_at, left_at) values ${values.join(", ")}`,
          circle.members.flatMap((m, position) => [
            m.id,
            circle.id,
            position,
            m.userId,
            m.displayName,
            m.status,
            iso(m.joinedAt),
            isoOrNull(m.leftAt),
          ]),
        );
      }
      const { invite } = circle;
      if (invite) {
        await exec.query(
          "insert into pactjoy.circle_invites (circle_id, code, created_at, expires_at, created_by) values ($1, $2, $3::timestamptz, $4::timestamptz, $5)",
          [circle.id, invite.code, iso(invite.createdAt), iso(invite.expiresAt), invite.createdBy],
        );
      }
    },
  };
}
