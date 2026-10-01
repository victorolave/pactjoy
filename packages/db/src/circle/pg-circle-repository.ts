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
import type { SqlExecutor } from "../client.ts";

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

export function createPgCircleRepository(exec: SqlExecutor): CircleRepository {
  async function load(row: CircleRow | undefined): Promise<Circle | null> {
    if (!row) return null;
    const members = await exec.query<MemberRow>(
      "select id, user_id, status, joined_at, left_at from pactjoy.circle_members where circle_id = $1 order by position",
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

    async guardVersion() {
      // A silent no-op would break the port (D5), so fail loudly until B4b.
      throw new Error("CircleRepository.guardVersion is not implemented yet (B4b)");
    },

    async save(circle, expectedVersion) {
      const root = [circle.id, circle.name, iso(circle.createdAt), isoOrNull(circle.archivedAt)];
      if (expectedVersion === null) {
        // A duplicate id raises 23505 on circles_pkey, which the unit of work maps to ConcurrencyConflict.
        await exec.query(
          "insert into pactjoy.circles (id, name, created_at, archived_at, version) values ($1, $2, $3::timestamptz, $4::timestamptz, $5)",
          [...root, circle.version],
        );
      } else {
        // Only mutable columns are SET: `id` is a key column (never SET, ADR-0010) and `created_at` never changes.
        const { rowCount } = await exec.query(
          "update pactjoy.circles set name = $2, archived_at = $3::timestamptz, version = $4 where id = $1 and version = $5",
          [circle.id, circle.name, isoOrNull(circle.archivedAt), circle.version, expectedVersion],
        );
        if (rowCount === 0) throw new ConcurrencyConflict();
        await exec.query("delete from pactjoy.circle_members where circle_id = $1", [circle.id]);
        await exec.query("delete from pactjoy.circle_invites where circle_id = $1", [circle.id]);
      }
      if (circle.members.length > 0) {
        const values = circle.members.map((_, i) => {
          const n = i * 7;
          return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}::timestamptz, $${n + 7}::timestamptz)`;
        });
        await exec.query(
          `insert into pactjoy.circle_members (id, circle_id, position, user_id, status, joined_at, left_at) values ${values.join(", ")}`,
          circle.members.flatMap((m, position) => [
            m.id,
            circle.id,
            position,
            m.userId,
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
