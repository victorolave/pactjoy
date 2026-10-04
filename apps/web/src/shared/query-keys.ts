export const todayKey = ["today"] as const;
/** The viewer's circle for the Circle tab. Not persisted offline: a stale copy would show a circle the user left. */
export const myCircleKey = ["myCircle"] as const;
/** What a code leads to; one entry per code, enabled only at 6 characters. */
export const invitePreviewKey = (code: string) => ["invitePreview", code] as const;
