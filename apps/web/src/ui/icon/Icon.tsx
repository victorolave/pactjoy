import {
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CloudOff,
  Info,
  type LucideIcon,
  Repeat,
  RotateCw,
  Sun,
  UserRound,
  Users,
  X,
} from "lucide-react";

/**
 * The only module that imports `lucide-react` (Biome enforces it). Screens name an icon by its
 * Lucide kebab-case id, so swapping the icon set means editing this map only.
 */
const GLYPHS = {
  sun: Sun,
  "calendar-days": CalendarDays,
  users: Users,
  "circle-check": CircleCheck,
  "circle-alert": CircleAlert,
  "circle-pause": CirclePause,
  "cloud-off": CloudOff,
  check: Check,
  repeat: Repeat,
  "rotate-cw": RotateCw,
  info: Info,
  x: X,
  "user-round": UserRound,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof GLYPHS;
export type IconSize = "sm" | "md" | "lg";

/** Mirrors the design system's `--icon-stroke` token (SVG attributes cannot read CSS variables). */
const STROKE_WIDTH = 1.8;

export interface IconProps {
  readonly name: IconName;
  readonly size?: IconSize;
  /** Accessible name. Omit for a decorative icon (it is then hidden from assistive tech). */
  readonly label?: string;
}

export function Icon({ name, size = "md", label }: IconProps) {
  const Glyph = GLYPHS[name];
  const box = `var(--icon-${size})`;
  return (
    <Glyph
      className="pj-icon"
      strokeWidth={STROKE_WIDTH}
      style={{ width: box, height: box }}
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    />
  );
}
