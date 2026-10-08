import {
  Bell,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CloudOff,
  Coffee,
  Copy,
  Dumbbell,
  Eye,
  EyeOff,
  Flower2,
  Footprints,
  Handshake,
  History,
  Info,
  type LucideIcon,
  MessageSquarePlus,
  Minus,
  Moon,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  RotateCw,
  Settings,
  Share2,
  Sun,
  Trash2,
  UserPlus,
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
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  repeat: Repeat,
  "rotate-cw": RotateCw,
  history: History,
  info: Info,
  minus: Minus,
  pencil: Pencil,
  plus: Plus,
  "message-square-plus": MessageSquarePlus,
  "trash-2": Trash2,
  x: X,
  "user-round": UserRound,
  copy: Copy,
  "refresh-cw": RefreshCw,
  share: Share2,
  "user-plus": UserPlus,
  handshake: Handshake,
  settings: Settings,
  "book-open": BookOpen,
  brain: Brain,
  coffee: Coffee,
  dumbbell: Dumbbell,
  eye: Eye,
  "eye-off": EyeOff,
  "flower-2": Flower2,
  footprints: Footprints,
  palette: Palette,
  moon: Moon,
  bell: Bell,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof GLYPHS;
export type IconSize =
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "14"
  | "16"
  | "18"
  | "20"
  | "22"
  | 14
  | 16
  | 18
  | 20
  | 22
  | 24
  | 32;

/** Mirrors the design system's `--icon-stroke` token (SVG attributes cannot read CSS variables). */
const STROKE_WIDTH = 1.8;

export interface IconProps {
  readonly name: IconName;
  readonly size?: IconSize;
  /** Custom stroke width, e.g. 2.2 for badges. Defaults to 1.8. */
  readonly strokeWidth?: number;
  /** Color token override (e.g. `var(--pj-muted)`). Defaults to inherited color. */
  readonly color?: string;
  /** Accessible name. Omit for a decorative icon (it is then hidden from assistive tech). */
  readonly label?: string;
}

export function Icon({ name, size = "md", strokeWidth = STROKE_WIDTH, color, label }: IconProps) {
  const Glyph = GLYPHS[name];
  const s = String(size);
  const box = s === "24" ? "var(--icon-md)" : s === "32" ? "var(--icon-lg)" : `var(--icon-${s})`;
  return (
    <Glyph
      className="pj-icon"
      strokeWidth={strokeWidth}
      style={{ width: box, height: box, color }}
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    />
  );
}
