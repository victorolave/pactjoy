/** Joins the truthy class names. */
export const cx = (...names: ReadonlyArray<string | false | null | undefined>): string =>
  names.filter(Boolean).join(" ");
