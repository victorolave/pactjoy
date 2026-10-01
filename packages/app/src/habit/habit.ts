import type { HabitId, UserId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { isStorableText } from "../shared/storable-text.ts";
import type { Instant } from "../time/instant.ts";

/**
 * A long-term behavior that lives across seasons (Hábito). `why` and
 * `category` are both optional free text -- category suggestions are
 * UI-only, not a closed list (P2-4).
 */
export interface Habit {
  readonly id: HabitId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly why: string | null;
  readonly category: string | null;
  readonly createdAt: Instant;
  readonly version: number;
}

/**
 * P2-4 leaves category free text; the 40-character maximum is a user
 * decision (2026-09-30), not a spec default.
 */
export const MAX_CATEGORY_LENGTH = 40;

export type BuildHabitError =
  | { readonly kind: "InvalidName" }
  | { readonly kind: "InvalidWhy" }
  | { readonly kind: "InvalidCategory" }
  | { readonly kind: "CategoryTooLong" };

export interface BuildHabitInput {
  readonly id: HabitId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly why?: string | null;
  readonly category?: string | null;
  readonly now: Instant;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Pure constructor for a brand-new {@link Habit} (SS-1, SS-2). `create-habit.ts`
 * is the only production caller -- it supplies ids/clock via ports, this
 * function only validates and assembles (same split as `circle.ts`'s
 * `buildCircle`).
 */
export function buildHabit(input: BuildHabitInput): Result<Habit, BuildHabitError> {
  const name = input.name.trim();
  if (name.length === 0 || !isStorableText(name)) {
    return err({ kind: "InvalidName" });
  }

  const why = trimmedOrNull(input.why);
  if (why !== null && !isStorableText(why)) {
    return err({ kind: "InvalidWhy" });
  }

  const category = trimmedOrNull(input.category);
  if (category !== null && !isStorableText(category)) {
    return err({ kind: "InvalidCategory" });
  }
  if (category !== null && category.length > MAX_CATEGORY_LENGTH) {
    return err({ kind: "CategoryTooLong" });
  }

  return ok({
    id: input.id,
    ownerId: input.ownerId,
    name,
    why,
    category,
    createdAt: input.now,
    version: 0,
  });
}
