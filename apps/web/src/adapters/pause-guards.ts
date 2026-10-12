import type { MyPauseRequests } from "../ports/wire.ts";

/**
 * Runtime checks for the pause reads. A private Commitment must reach an approver as EXACTLY
 * `{kind: "hidden", commitmentId}`, so a server bug cannot leak a hidden habit through the client
 * (Q15, PS-S5). A 2xx that fails becomes ApiError("Internal"), never data.
 */

type Check = (value: unknown) => boolean;
type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id: Check = (v) => typeof v === "string" && v.length > 0;
const text: Check = (v) => typeof v === "string";
const count: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const date: Check = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const oneOf =
  (...options: readonly unknown[]): Check =>
  (v) =>
    options.includes(v);
const list =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);
const shape =
  (fields: Readonly<Record<string, Check>>, exact = false): Check =>
  (v) =>
    isRec(v) &&
    Object.entries(fields).every(([key, check]) => check(v[key])) &&
    (!exact || Object.keys(v).every((key) => key in fields));

const status = oneOf("pending", "approved", "rejected", "cancelled");
const reason = oneOf("health", "travel", "work", "other");
const choice = oneOf("approve", "reject");

const ownCommitment = shape({
  commitmentId: id,
  habitName: text,
  icon: nullable(text),
  resumedOn: nullable(date),
});
const approver = shape({ memberId: id, displayName: text, response: nullable(choice) });

export const isPauseRequest: Check = shape({
  id,
  status,
  reason,
  note: nullable(text),
  startDate: date,
  endDate: nullable(date),
  requestedAt: text,
  autoApproveAt: text,
  decidedAt: nullable(text),
  commitments: list(ownCommitment),
  approvers: list(approver),
});

const visible = shape(
  { kind: oneOf("visible"), commitmentId: id, habitName: text, icon: nullable(text) },
  true,
);
const hidden = shape({ kind: oneOf("hidden"), commitmentId: id }, true);

export const isPauseApproval: Check = shape({
  id,
  status,
  reason,
  note: nullable(text),
  startDate: date,
  endDate: nullable(date),
  requestedAt: text,
  autoApproveAt: text,
  requester: shape({ memberId: id, displayName: text }, true),
  myResponse: nullable(choice),
  commitments: list((v) => visible(v) || hidden(v)),
});

const budget = shape({ commitmentId: id, cap: count, usedDays: count, remainingDays: count });
const points = shape({ before: count, after: count });
const redistribution = shape({
  pauseRequestId: id,
  total: points,
  commitments: list(
    shape({
      commitmentId: id,
      before: count,
      after: count,
      weightPoints: count,
      opportunities: points,
    }),
  ),
});
const resumePreview = shape({
  pauseRequestId: id,
  commitmentId: id,
  weekOpportunities: nullable(count),
});

export const isMyPauseRequests = (data: unknown): data is MyPauseRequests =>
  shape({
    seasonId: nullable(id),
    mine: list(isPauseRequest),
    awaitingMe: list(isPauseApproval),
    budgets: list(budget),
    redistributed: nullable(redistribution),
    resumePreviews: list(resumePreview),
  })(data);
