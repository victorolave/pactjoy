/** What the note field says about who sees the note AND the photo of a commitment (design 19). */
export const visibilityHint = (privacy: "visible" | "private"): string =>
  privacy === "visible"
    ? "Visible para el círculo, igual que este compromiso."
    : "Solo tú la verás";
