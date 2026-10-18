/**
 * The account-deletion coverage guard (ADR-0019, ADR-0010 addendum).
 *
 * `ERASURE_COVERAGE` says, column by column, what account erasure does with every place a person
 * can leave data in. `scanMigrations` reads EVERY migration, in order, so a column added later
 * (a `create table` or an `alter table ... add column`) cannot be forgotten: the guard test fails
 * until the new column is registered here, seeded by the sentinel and handled by the use case.
 *
 * Must be registered: every uuid column named after a person (member, user, owner, recipient,
 * author, peer, `*_by`, ...) and every column whose type is outside the numeric, time, boolean and
 * uuid allowlist (text, character varying, json, citext, bytea, arrays...), because free text is not
 * safe just because its name does not say "member". A column whose values a CHECK pins to a closed
 * list (an enum) is exempt: it cannot hold what a person typed. The scan THROWS on a statement it
 * cannot follow (a type change, a rename, a table outside the `pactjoy` schema), so a schema change
 * cannot slip past the registry.
 */

export type ErasureRule = "delete" | "anonymize" | "keep";

export interface ErasureEntry {
  /**
   * `delete`: the row goes (or the value is nulled with it); `anonymize`: the column is rewritten in
   * place; `keep`: untouched, with the reason it holds nothing personal.
   */
  readonly rule: ErasureRule;
  readonly how: string;
  readonly reason: string;
}

export interface ScannedColumn {
  readonly table: string;
  readonly column: string;
  readonly type: string;
  /** True when a CHECK pins the column to a closed list (`col in (...)` or `col = '...'`). */
  readonly enumChecked: boolean;
}

export interface CoverageGaps {
  /** Required columns without an entry. */
  readonly missing: readonly string[];
  /** Entries for a column that no migration defines. */
  readonly stale: readonly string[];
  /** Tables holding a required or registered column that the sentinel does not seed. */
  readonly unseeded: readonly string[];
}

/** A uuid column that names a person. */
export const PERSON_COLUMN =
  /(^|_)(member|user|owner|recipient|sender|actor|reactor|viewer|target|requester|approver|creator|author|peer|participant)(_id)?$|(^|_)by$/;

/**
 * The types that cannot hold what a person typed. Every other type (text, character varying, char,
 * json, jsonb, citext, bytea, inet, arrays, user-defined...) is free text and must be registered,
 * unless a CHECK pins it to a closed list.
 */
const SAFE_TYPES = new Set([
  "smallint",
  "integer",
  "int",
  "int2",
  "int4",
  "int8",
  "bigint",
  "numeric",
  "decimal",
  "real",
  "double",
  "float4",
  "float8",
  "smallserial",
  "serial",
  "bigserial",
  "boolean",
  "bool",
  "uuid",
  "date",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "interval",
]);

const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, "");

/** Splits at commas outside parentheses and string literals. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** Splits at semicolons outside string literals. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") quoted = !quoted;
    else if (sql[i] === ";" && !quoted) {
      out.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  out.push(sql.slice(start));
  return out.map((statement) => statement.trim()).filter((statement) => statement !== "");
}

const TABLE_ELEMENT = /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i;
const COLUMN_DEFINITION = /^"?(\w+)"?\s+"?(\w+)"?(\s*\[\s*\])*/;
const SCHEMA = "pactjoy";
const CREATE_ANY =
  /^create\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\b/i;
const CREATE_TABLE =
  /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(([\s\S]*)\)$/i;
const ALTER_ANY = /^alter\s+table\b/i;
const ALTER_TABLE =
  /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s+([\s\S]*)$/i;
const ADD_COLUMN = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]*)$/i;
const ADD_CONSTRAINT = /^add\s+(constraint|primary\s+key|unique|check|foreign\s+key|exclude)\b/i;
const DROP_CONSTRAINT = /^drop\s+constraint\b/i;
const DROP_COLUMN =
  /^drop\s+(?:column\s+)?(?:if\s+exists\s+)?"?(\w+)"?(?:\s+(?:cascade|restrict))?$/i;
const ROW_SECURITY = /^(?:enable|disable|force|no\s+force)\s+row\s+level\s+security$/i;
const COLUMN_DEFAULT_OR_NULL =
  /^alter\s+(?:column\s+)?"?\w+"?\s+(?:set|drop)\s+(?:not\s+null|default\b)/i;

/** Columns a CHECK pins to a closed list, anywhere in the statement. */
function enumColumns(statement: string): string[] {
  return [...statement.matchAll(/check\s*\(\s*"?(\w+)"?\s*(?:in\s*\(|=\s*')/gi)].flatMap((match) =>
    match[1] ? [match[1].toLowerCase()] : [],
  );
}

const head = (statement: string): string => statement.replace(/\s+/g, " ").slice(0, 100);

/** The guard must follow every table; a schema it does not know is a failure, never a skip. */
function qualified(schema: string | undefined, table: string, statement: string): string {
  if (schema?.toLowerCase() !== SCHEMA) {
    throw new Error(
      `erasure-coverage: a table outside the ${SCHEMA} schema cannot be followed (${schema ?? "no schema"}.${table}): ${head(statement)}`,
    );
  }
  return table.toLowerCase();
}

/**
 * Reads every column the migrations define, in order. A later definition of a column replaces the
 * earlier, `drop column` removes it. Throws on any statement it cannot follow (a type change, a
 * rename, another schema...): a schema change must never bypass the registry silently.
 */
export function scanMigrations(sources: readonly string[]): ScannedColumn[] {
  const columns = new Map<string, Omit<ScannedColumn, "enumChecked">>();
  const pinned = new Set<string>();

  const define = (table: string, definition: string, statement: string): void => {
    const match = COLUMN_DEFINITION.exec(definition);
    if (!match?.[1] || !match[2]) {
      throw new Error(`erasure-coverage: cannot read the column definition in: ${head(statement)}`);
    }
    columns.set(`${table}.${match[1].toLowerCase()}`, {
      table,
      column: match[1].toLowerCase(),
      type: `${match[2].toLowerCase()}${match[3] ? "[]" : ""}`,
    });
  };

  for (const source of sources) {
    for (const statement of statements(stripComments(source))) {
      let table: string | undefined;
      if (CREATE_ANY.test(statement)) {
        const create = CREATE_TABLE.exec(statement);
        if (!create?.[2] || create[3] === undefined) {
          throw new Error(`erasure-coverage: cannot read this create table: ${head(statement)}`);
        }
        table = qualified(create[1], create[2], statement);
        for (const element of splitTopLevel(create[3])) {
          if (!TABLE_ELEMENT.test(element)) define(table, element, statement);
        }
      } else if (ALTER_ANY.test(statement)) {
        const alter = ALTER_TABLE.exec(statement);
        if (!alter?.[2] || alter[3] === undefined) {
          throw new Error(`erasure-coverage: cannot read this alter table: ${head(statement)}`);
        }
        const altered = qualified(alter[1], alter[2], statement);
        table = altered;
        for (const action of splitTopLevel(alter[3])) {
          if (ADD_CONSTRAINT.test(action) || DROP_CONSTRAINT.test(action)) continue;
          if (ROW_SECURITY.test(action) || COLUMN_DEFAULT_OR_NULL.test(action)) continue;
          const dropped = DROP_COLUMN.exec(action);
          if (dropped?.[1]) {
            columns.delete(`${altered}.${dropped[1].toLowerCase()}`);
            continue;
          }
          const added = ADD_COLUMN.exec(action);
          if (added?.[1]) {
            define(altered, added[1], statement);
            continue;
          }
          throw new Error(
            `erasure-coverage: an alter of ${altered} the guard does not understand (${head(action)}); teach scanMigrations about it and re-check ERASURE_COVERAGE`,
          );
        }
      }
      if (table) for (const column of enumColumns(statement)) pinned.add(`${table}.${column}`);
    }
  }
  return [...columns.entries()].map(([key, column]) => ({
    ...column,
    enumChecked: pinned.has(key),
  }));
}

const keyOf = (column: Pick<ScannedColumn, "table" | "column">): string =>
  `${column.table}.${column.column}`;

const isRequired = (column: ScannedColumn): boolean =>
  (column.type === "uuid" && PERSON_COLUMN.test(column.column)) ||
  (!SAFE_TYPES.has(column.type) && !column.enumChecked);

/** What the guard fails on: see {@link CoverageGaps}. */
export function findCoverageGaps(
  scanned: readonly ScannedColumn[],
  registry: Readonly<Record<string, ErasureEntry>>,
  seeded: ReadonlySet<string>,
): CoverageGaps {
  const known = new Set(scanned.map(keyOf));
  const required = scanned.filter(isRequired);
  const missing = required.map(keyOf).filter((key) => !(key in registry));
  const stale = Object.keys(registry).filter((key) => !known.has(key));
  const holders = new Set([
    ...required.map((column) => column.table),
    ...Object.keys(registry).flatMap((key) =>
      known.has(key) ? [key.split(".")[0] as string] : [],
    ),
  ]);
  return { missing, stale, unseeded: [...holders].filter((table) => !seeded.has(table)) };
}

/**
 * Every table the sentinel (`account-deletion.pg.test.ts`) seeds with at least one row before it
 * erases Andrea, and checks is non-empty first, so a table cannot be listed without being seeded.
 */
export const SEEDED_TABLES: ReadonlySet<string> = new Set([
  "automaticity_responses",
  "circle_invites",
  "circle_members",
  "circles",
  "commitment_reminders",
  "encouragements",
  "entries",
  "entry_photos",
  "feed_reactions",
  "habits",
  "notification_outbox",
  "nudge_dismissals",
  "pause_request_commitments",
  "pause_requests",
  "pause_responses",
  "push_subscriptions",
  "reviews",
  "season_approvals",
  "season_closure_decisions",
  "season_closures",
  "season_commitments",
  "seasons",
]);

const del = (how: string, reason: string): ErasureEntry => ({ rule: "delete", how, reason });
const anonymize = (how: string, reason: string): ErasureEntry => ({
  rule: "anonymize",
  how,
  reason,
});
const keep = (how: string, reason: string): ErasureEntry => ({ rule: "keep", how, reason });

const HABIT = "habits.deleteByOwner removes the row (eraseAccount, last step)";
const OWNER_ONLY = "Owner-only data: nobody else reads it, so nothing is kept";
const PSEUDONYM =
  "A member id outlives the tombstone but no longer links to a user or a name (circle_members.user_id is rotated, display_name is blank)";
const IDS_ONLY = "Opaque ids and numbers only (REQ-K1): no name, note or user id";

/**
 * What account erasure does with every place a person can leave data in (ADR-0019). The `how` is what
 * `eraseAccount` and the helpers it composes really do; `account-deletion.pg.test.ts` proves it on
 * Postgres by dumping every table after a deletion.
 */
export const ERASURE_COVERAGE: Readonly<Record<string, ErasureEntry>> = {
  "habits.owner_id": del(HABIT, OWNER_ONLY),
  "habits.name": del(HABIT, OWNER_ONLY),
  "habits.why": del(HABIT, OWNER_ONLY),
  "habits.category": del(HABIT, OWNER_ONLY),
  "habits.icon": del(HABIT, OWNER_ONLY),

  "circles.name": keep(
    "Untouched while the circle has an active member; the whole row goes with a fully erased circle (hardDeleteCircle)",
    "Circle-owned name, chosen for the group and not for one person",
  ),
  "circle_members.user_id": anonymize(
    "eraseMember rotates it to a fresh unlinked uuid in the tombstoning circles.save",
    "The only link from a membership to the auth identity",
  ),
  "circle_members.display_name": anonymize(
    "eraseMember sets it to '' (ERASED_DISPLAY_NAME); peers render it generically",
    "A name the person chose for one circle",
  ),
  "circle_members.erased_at": keep(
    "eraseMember stamps it: the tombstone marker",
    "An instant, not a person's data; it tells a fully erased circle apart",
  ),
  "circle_invites.code": del(
    "eraseInviteOf drops the invite an erased member created, inside the tombstoning circles.save",
    "Owner decision: an invite the erased person created goes with them; another member's invite stays",
  ),
  "circle_invites.created_by": del(
    "eraseInviteOf drops the invite an erased member created, inside the tombstoning circles.save",
    "Owner decision: an invite the erased person created goes with them; another member's invite stays",
  ),

  "seasons.time_zone": keep(
    "Untouched; the row goes with a fully erased circle",
    "An IANA zone name that every opportunity of the season is scored in, shared by the circle",
  ),
  "season_commitments.member_id": keep(
    "Untouched (the commitment is hidden, not removed)",
    PSEUDONYM,
  ),
  "season_commitments.habit_id": keep(
    "Untouched; the habit row it names is deleted, so it dangles",
    "An opaque id with no foreign key; nothing resolves it once the habit is gone",
  ),
  "season_commitments.measure": anonymize(
    "hideCommitments saves the season with customLabel := null (privacy := private in the same save)",
    "Scoring inputs stay byte-identical; the custom unit label is the one string a person typed",
  ),
  "season_approvals.member_id": keep(
    "Untouched; leaveCircleCore resets open-pact approvals",
    PSEUDONYM,
  ),

  "entries.member_id": keep("Untouched", `${PSEUDONYM}; the entry is a scoring fact`),
  "entries.client_request_id": anonymize(
    "entries.eraseEvidence sets it to the entry id",
    "Client-supplied idempotency text; the entry id is already public to the circle",
  ),
  "entries.request_fingerprint": anonymize(
    "entries.eraseEvidence sets it to 'erased'",
    "Plain text of the request, including the note",
  ),
  "entries.note": anonymize(
    "entries.eraseEvidence nulls it, tombstones included",
    "Free text the person wrote",
  ),
  "entries.photo_id": anonymize(
    "entries.eraseEvidence nulls it; releaseMemberPhotos frees the ledger row",
    "Links an entry to its evidence photo",
  ),

  "pause_requests.member_id": keep("Untouched", `${PSEUDONYM}; the pause is a scoring fact`),
  "pause_requests.reason": anonymize(
    "eraseMemberPauseDetails saves reason := 'other' through a version-checked save",
    "A health reason is sensitive; the reason is not a scoring input",
  ),
  "pause_requests.note": anonymize(
    "eraseMemberPauseDetails saves note := null through a version-checked save",
    "Free text the person wrote",
  ),
  "pause_request_commitments.commitment_id": keep(
    "Untouched",
    "An opaque id; which commitments were paused is a scoring fact",
  ),
  "pause_responses.member_id": keep(
    "Untouched; leaveCircleCore settles a pending request without the leaver",
    `${PSEUDONYM}; the vote is part of the decision history`,
  ),

  "reviews.member_id": del("eraseMemberReviews: reviews.deleteByMembers", OWNER_ONLY),
  "reviews.reflection_helped": del("eraseMemberReviews: reviews.deleteByMembers", OWNER_ONLY),
  "reviews.reflection_hard": del("eraseMemberReviews: reviews.deleteByMembers", OWNER_ONLY),
  "automaticity_responses.item1": del(
    "Cascades with its review (eraseMemberReviews)",
    "Private SRBAI answers",
  ),

  "season_closures.member_id": del(
    "eraseMemberClosures: seasonClosures.deleteByMembers, after the reactions to their graduation items",
    "Owner decision (option A): closures and their graduate decisions are deleted, the graduation items disappear",
  ),
  "season_closure_decisions.decision": del(
    "Cascades with its closure (eraseMemberClosures)",
    "Private decisions; no pseudonymous graduation record is kept",
  ),

  "entry_photos.member_id": del(
    "releaseMemberPhotos releases the rows inside the transaction; purgeErasedPhotos deletes the objects, then the rows, after the commit; a hard-deleted circle drops its rows and deleteObjects removes the objects",
    "The photo is the person's; a row a failed purge leaves released only waits for the sweep",
  ),
  "entry_photos.object_key": del(
    "releaseMemberPhotos releases the rows inside the transaction; purgeErasedPhotos deletes the objects, then the rows, after the commit; a hard-deleted circle drops its rows and deleteObjects removes the objects",
    "The photo is the person's; a row a failed purge leaves released only waits for the sweep",
  ),

  "notification_outbox.recipient_member_id": del(
    "eraseMemberNotifications: notifications.deleteAddressedTo, in every state",
    "A notice addressed to the erased person; a fully erased circle also drops its notices (deleteByCircles)",
  ),
  "notification_outbox.recipient_user_id": del(
    "eraseMemberNotifications: notifications.deleteAddressedTo by the ORIGINAL user id, in every state",
    "The original auth uuid must not survive, not even in a sent or failed row",
  ),
  "notification_outbox.dedupe_key": keep(
    "Untouched on notices addressed to peers (a notice to the erased is deleted whole)",
    `Event, season, commitment and member ids joined by ':': ${IDS_ONLY}`,
  ),
  "notification_outbox.params": keep("Untouched on notices addressed to peers", IDS_ONLY),
  "notification_outbox.time_zone": keep(
    "Untouched on notices addressed to peers",
    "An IANA zone name of the season",
  ),
  "push_subscriptions.user_id": del(
    "eraseMemberNotifications: pushSubscriptions.removeAllOfUser",
    "Device ownership",
  ),
  "push_subscriptions.endpoint": del(
    "eraseMemberNotifications: pushSubscriptions.removeAllOfUser",
    "A push endpoint identifies a device",
  ),
  "push_subscriptions.p256dh": del(
    "eraseMemberNotifications: pushSubscriptions.removeAllOfUser",
    "Device encryption key",
  ),
  "push_subscriptions.auth": del(
    "eraseMemberNotifications: pushSubscriptions.removeAllOfUser",
    "Device secret",
  ),
  "commitment_reminders.member_id": del(
    "eraseMemberReminders: reminders.deleteByMembers; a fully erased circle deletes by season",
    "The owner's reminder setting",
  ),

  "feed_reactions.member_id": keep(
    "Untouched when the circle goes on; a fully erased circle deletes by season. Reactions to the erased member's graduation items are deleted with their closure",
    `${PSEUDONYM}; a reaction is an emoji on a derived item`,
  ),
  "feed_reactions.item_key": keep(
    "Untouched, except the keys of the erased member's graduation items, which are deleted",
    "Lowercase kind plus commitment or habit ids and numbers, never text",
  ),
  "encouragements.sender_member_id": keep(
    "Untouched: what the erased person sent stays, anonymous to its recipient; a fully erased circle deletes by season",
    `${PSEUDONYM}; the message is an emoji and a week`,
  ),
  "encouragements.recipient_member_id": del(
    "eraseMemberEncouragements: encouragements.deleteByRecipients",
    "What the erased person received is theirs and nobody else reads it",
  ),
  "nudge_dismissals.viewer_member_id": del(
    "eraseMemberEncouragements: nudgeDismissals.deleteByMembers, either side",
    "A private 'not now' that no longer means anything",
  ),
  "nudge_dismissals.target_member_id": del(
    "eraseMemberEncouragements: nudgeDismissals.deleteByMembers, either side",
    "A private 'not now' that no longer means anything",
  ),
};
