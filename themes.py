"""
VibeCast Themes Definition & Theming Engine
Color tokens:
  bg_primary, bg_card, accent, accent_hover, text_main, text_muted, border, meter_gradient
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
            border="#222222",
            meter_gradient="linear-gradient(180deg, #60a5fa, #3b82f6)"
        )
    ),
    "catppuccin": Theme(
        name="Catppuccin Mocha",
        is_dark=True,
        tokens=ThemeTokens(
            bg_primary="#1e1e2e",
            bg_card="#313244",
            accent="#b4befe",
            accent_hover="#fab387",
            text_main="#cdd6f4",
            text_muted="#a6adc8",
            border="#45475a",
            meter_gradient="linear-gradient(180deg, #fab387, #b4befe)"
        )
    ),
    "dracula": Theme(
        name="Dracula Classic",
        is_dark=True,
        tokens=ThemeTokens(
            bg_primary="#282a36",
            bg_card="#44475a",
            accent="#ff79c6",
            accent_hover="#50fa7b",
            text_main="#f8f8f2",
            text_muted="#6272a4",
            border="#6272a4",
            meter_gradient="linear-gradient(180deg, #ff79c6, #50fa7b)"
        )
    ),
    "nord": Theme(
        name="Nord Frost",
        is_dark=True,
        tokens=ThemeTokens(
            bg_primary="#2e3440",
            bg_card="#3b4252",
            accent="#88c0d0",
            accent_hover="#81a1c1",
            text_main="#eceff4",
            text_muted="#d8dee9",
            border="#4c566a",
            meter_gradient="linear-gradient(180deg, #8fbcbb, #88c0d0)"
        )
    ),
    "solarized": Theme(
        name="Solarized Light / Minimal Paper",
        is_dark=False,
        tokens=ThemeTokens(
            bg_primary="#fdf6e3",
            bg_card="#eee8d5",
            accent="#b58900",
            accent_hover="#cb4b16",
            text_main="#657b83",
            text_muted="#93a1a1",
            border="#dfdac9",
            meter_gradient="linear-gradient(180deg, #cb4b16, #b58900)"
        )
    ),
}

CONFIG_FILE = "config.json"

def get_theme(theme_id: str) -> Optional[Theme]:
    return THEMES.get(theme_id.lower())

def list_themes() -> Dict[str, str]:
    return {k: v.name for k, v in THEMES.items()}

def load_config(config_path: str = CONFIG_FILE) -> Dict[str, Any]:
    path = Path(config_path)
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"theme": "cyberpunk", "volume": 80.0, "overlay": {"always_on_top": True}}

def save_config(config_data: Dict[str, Any], config_path: str = CONFIG_FILE) -> None:
    path = Path(config_path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    print(f"Loaded {len(THEMES)} themes successfully:")
    for k, v in THEMES.items():
        print(f"  [{k}] {v.name} -> primary {v.tokens.bg_primary}, accent {v.tokens.accent}")
