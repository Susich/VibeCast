"""
VibeCast Themes Definition & Theming Engine
Color tokens:
  bg_primary, bg_card, accent, accent_hover, text_main, text_muted, border, meter_gradient
Only dark themes are supported.
"""
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Any, Optional

@dataclass
class ThemeTokens:
    bg_primary: str
    bg_card: str
    accent: str
    accent_hover: str
    text_main: str
    text_muted: str
    border: str
    meter_gradient: str

@dataclass
class Theme:
    name: str
    is_dark: bool
    tokens: ThemeTokens

THEMES: Dict[str, Theme] = {
    "cyberpunk": Theme(
        name="Cyberpunk Neon",
        is_dark=True,
        tokens=ThemeTokens(
            bg_primary="#0d0e15",
            bg_card="#161926",
            accent="#00f0ff",
            accent_hover="#38f9d7",
            text_main="#f0f6fc",
            text_muted="#bd93f9",
            border="#2e334d",
            meter_gradient="linear-gradient(180deg, #00f0ff, #bd93f9)"
        )
    ),
    "midnight": Theme(
        name="Midnight OLED",
        is_dark=True,
        tokens=ThemeTokens(
            bg_primary="#000000",
            bg_card="#121212",
            accent="#3b82f6",
            accent_hover="#60a5fa",
            text_main="#e0e0e0",
            text_muted="#888888",
            border="#242424",
            meter_gradient="linear-gradient(180deg, #60a5fa, #3b82f6)"
        )
    ),
    "catppuccin": Theme(
        name="Catppuccin Mocha",
        is_dark=True,
        tokens=ThemeTokens(
            bg_primary="#181825",
            bg_card="#1e1e2e",
            accent="#b4befe",
            accent_hover="#fab387",
            text_main="#cdd6f4",
            text_muted="#a6adc8",
            border="#313244",
            meter_gradient="linear-gradient(180deg, #fab387, #b4befe)"
        )
    ),
    "dracula": Theme(
        name="Dracula Classic",
        is_dark=True,
        tokens=ThemeTokens(
            bg_primary="#1e1f29",
            bg_card="#282a36",
            accent="#ff79c6",
            accent_hover="#50fa7b",
            text_main="#f8f8f2",
            text_muted="#6272a4",
            border="#44475a",
            meter_gradient="linear-gradient(180deg, #ff79c6, #50fa7b)"
        )
    ),
    "nord": Theme(
        name="Nord Frost",
        is_dark=True,
        tokens=ThemeTokens(
            bg_primary="#242933",
            bg_card="#2e3440",
            accent="#88c0d0",
            accent_hover="#81a1c1",
            text_main="#eceff4",
            text_muted="#d8dee9",
            border="#3b4252",
            meter_gradient="linear-gradient(180deg, #8fbcbb, #88c0d0)"
        )
    )
}

DEFAULT_THEME = "cyberpunk"

def get_theme(theme_id: str) -> Theme:
    return THEMES.get(theme_id, THEMES[DEFAULT_THEME])

def get_config_path() -> Path:
    import os
    appdata = os.environ.get("APPDATA")
    if appdata:
        p = Path(appdata) / "com.vibecast.desktop" / "config.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        return p
    return Path("config.json")

def load_config() -> Dict[str, Any]:
    path = get_config_path()
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"theme": DEFAULT_THEME, "is_overlay": False, "volume": 80.0}

def save_config(config: Dict[str, Any]) -> None:
    path = get_config_path()
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")

def export_themes_json(filepath: Optional[Path] = None) -> str:
    out = {}
    for tid, t in THEMES.items():
        out[tid] = {
            "name": t.name,
            "isDark": t.is_dark,
            "tokens": asdict(t.tokens)
        }
    data = json.dumps(out, indent=2, ensure_ascii=False)
    if filepath:
        filepath.write_text(data, encoding="utf-8")
    return data

if __name__ == "__main__":
    print(f"Loaded {len(THEMES)} dark themes successfully:")
    for tid, t in THEMES.items():
        print(f"  [{tid}] {t.name} -> primary {t.tokens.bg_primary}, accent {t.tokens.accent}")
