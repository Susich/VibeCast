import themesData from "./themes.json";

export interface ThemeTokens {
  bg_primary: string;
  bg_card: string;
  accent: string;
  accent_hover: string;
  text_main: string;
  text_muted: string;
  border: string;
  meter_gradient: string;
}

export interface ThemeDefinition {
  name: string;
  isDark: boolean;
  tokens: ThemeTokens;
}

export type ThemeId =
  | "cyberpunk"
  | "midnight"
  | "catppuccin"
  | "dracula"
  | "nord";

export const THEMES: Record<ThemeId, ThemeDefinition> = themesData as Record<
  ThemeId,
  ThemeDefinition
>;

export const DEFAULT_THEME: ThemeId = "cyberpunk";

export function applyTheme(themeId: string): void {
  const normalizedId = (themeId in THEMES ? themeId : DEFAULT_THEME) as ThemeId;
  const theme = THEMES[normalizedId];
  if (!theme) return;

  const root = document.documentElement;
  const { tokens } = theme;

  // Base theme tokens
  root.style.setProperty("--bg-primary", tokens.bg_primary);
  root.style.setProperty("--bg-card", tokens.bg_card);
  root.style.setProperty("--accent", tokens.accent);
  root.style.setProperty("--accent-hover", tokens.accent_hover);
  root.style.setProperty("--text-main", tokens.text_main);
  root.style.setProperty("--text-muted", tokens.text_muted);
  root.style.setProperty("--border", tokens.border);
  root.style.setProperty("--meter-gradient", tokens.meter_gradient);

  // Derived layer surfaces
  const surface2 = adjustColorBrightness(tokens.bg_card, 7);
  const surface3 = adjustColorBrightness(tokens.bg_card, 14);
  root.style.setProperty("--surface-2", surface2);
  root.style.setProperty("--surface-3", surface3);

  // Synchronize legacy variables in styles.css for full component styling
  root.style.setProperty("--bg", tokens.bg_primary);
  root.style.setProperty("--bg-soft", tokens.bg_primary);
  root.style.setProperty("--surface", tokens.bg_card);
  root.style.setProperty("--line", tokens.border);
  root.style.setProperty("--line-soft", tokens.border);
  root.style.setProperty("--text", tokens.text_main);
  root.style.setProperty("--muted", tokens.text_muted);
  root.style.setProperty("--green", tokens.accent);
  root.style.setProperty("--green-strong", tokens.accent_hover);

  // Alpha variants for glows, badges, highlights
  root.style.setProperty("--green-dim", hexToRgba(tokens.accent, 0.14));
  root.style.setProperty("--accent-glow", hexToRgba(tokens.accent, 0.08));
  root.style.setProperty("--accent-shadow", hexToRgba(tokens.accent, 0.28));
  root.style.setProperty("--accent-text", getContrastTextColor(tokens.accent));

  root.setAttribute("data-theme", normalizedId);
  root.style.colorScheme = "dark";
}

function adjustColorBrightness(hex: string, percent: number): string {
  const cleanHex = hex.replace("#", "");
  if (cleanHex.length !== 6) return hex;
  const num = parseInt(cleanHex, 16);
  let r = (num >> 16) + Math.round(255 * (percent / 100));
  let g = ((num >> 8) & 0x00ff) + Math.round(255 * (percent / 100));
  let b = (num & 0x0000ff) + Math.round(255 * (percent / 100));
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace("#", "");
  if (cleanHex.length !== 6) return `rgba(0, 240, 255, ${alpha})`;
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getContrastTextColor(hex: string): string {
  const cleanHex = hex.replace("#", "");
  if (cleanHex.length !== 6) return "#070b11";
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  // Perceived luminance formula (ITU-R BT.709)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.45 ? "#070b11" : "#ffffff";
}
