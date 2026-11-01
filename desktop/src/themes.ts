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
  | "nord"
  | "solarized";

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

  root.style.setProperty("--bg-primary", tokens.bg_primary);
  root.style.setProperty("--bg-card", tokens.bg_card);
  root.style.setProperty("--accent", tokens.accent);
  root.style.setProperty("--accent-hover", tokens.accent_hover);
  root.style.setProperty("--text-main", tokens.text_main);
  root.style.setProperty("--text-muted", tokens.text_muted);
  root.style.setProperty("--border", tokens.border);
  root.style.setProperty("--meter-gradient", tokens.meter_gradient);

  // Synchronize existing variables in styles.css for full component styling
  root.style.setProperty("--bg", tokens.bg_primary);
  root.style.setProperty("--surface", tokens.bg_card);
  root.style.setProperty("--surface-2", adjustColorBrightness(tokens.bg_card, theme.isDark ? 8 : -6));
  root.style.setProperty("--surface-3", adjustColorBrightness(tokens.bg_card, theme.isDark ? 15 : -12));
  root.style.setProperty("--text", tokens.text_main);
  root.style.setProperty("--muted", tokens.text_muted);
  root.style.setProperty("--line", tokens.border);
  root.style.setProperty("--green", tokens.accent);
  root.style.setProperty("--green-strong", tokens.accent_hover);
  root.style.setProperty("--green-dim", hexToRgba(tokens.accent, 0.15));

  root.setAttribute("data-theme", normalizedId);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
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
