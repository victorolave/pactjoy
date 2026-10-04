/**
 * The name Perfil shows (PS-R1): the displayName in the circle; without a circle, the draft from
 * the name step; without one, the part of the email before the @; as a last resort, "Tú".
 */
export function profileName({
  memberName,
  draft,
  email,
}: {
  readonly memberName: string | null;
  readonly draft: string | null;
  readonly email: string | null;
}): string {
  if (memberName !== null) return memberName;
  if (draft !== null && draft.trim() !== "") return draft.trim();
  const local = email?.split("@")[0]?.trim() ?? "";
  return local === "" ? "Tú" : local;
}
