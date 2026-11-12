package com.vibecast.app.ui.theme

import androidx.compose.ui.graphics.Color

data class VibeTheme(
    val id: String,
    val name: String,
    val bgPrimary: Color,
    val bgCard: Color,
    val bgCardHigh: Color,
    val border: Color,
    val accent: Color,
    val accentHover: Color,
    val textMain: Color,
    val textMuted: Color,
    val textDim: Color = textMuted.copy(alpha = 0.65f),
    val accentDark: Color = accent.copy(alpha = 0.35f),
    val bgGradientTop: Color = bgPrimary,
    val bgGradientBottom: Color = bgPrimary,
)

object VibeThemes {
    val Cyberpunk = VibeTheme(
        id = "cyberpunk",
        name = "Cyberpunk Neon",
        bgPrimary = Color(0xFF0D0E15),
        bgCard = Color(0xFF161926),
        bgCardHigh = Color(0xFF1E2235),
        border = Color(0xFF2E334D),
        accent = Color(0xFF00F0FF),
        accentHover = Color(0xFF38F9D7),
        textMain = Color(0xFFF0F6FC),
        textMuted = Color(0xFFBD93F9),
        bgGradientTop = Color(0xFF121420),
        bgGradientBottom = Color(0xFF08090D),
    )

    val Midnight = VibeTheme(
        id = "midnight",
        name = "Midnight OLED",
        bgPrimary = Color(0xFF000000),
        bgCard = Color(0xFF121212),
        bgCardHigh = Color(0xFF1C1C1C),
        border = Color(0xFF242424),
        accent = Color(0xFF3B82F6),
        accentHover = Color(0xFF60A5FA),
        textMain = Color(0xFFE0E0E0),
        textMuted = Color(0xFF888888),
        bgGradientTop = Color(0xFF0A0A0A),
        bgGradientBottom = Color(0xFF000000),
    )

    val Synthwave = VibeTheme(
        id = "synthwave",
        name = "Synthwave 80s",
        bgPrimary = Color(0xFF120B1F),
        bgCard = Color(0xFF1D1233),
        bgCardHigh = Color(0xFF2A1A4A),
        border = Color(0xFF3B1E5F),
        accent = Color(0xFFFF2A85),
        accentHover = Color(0xFFFF71CE),
        textMain = Color(0xFFFFF0F8),
        textMuted = Color(0xFFF0A6CA),
        bgGradientTop = Color(0xFF190F2C),
        bgGradientBottom = Color(0xFF0B0614),
    )

    val Emerald = VibeTheme(
        id = "emerald",
        name = "Emerald Matrix",
        bgPrimary = Color(0xFF091410),
        bgCard = Color(0xFF10221C),
        bgCardHigh = Color(0xFF173027),
        border = Color(0xFF1B3A2F),
        accent = Color(0xFF10B981),
        accentHover = Color(0xFF34D399),
        textMain = Color(0xFFECFDF5),
        textMuted = Color(0xFF6EE7B7),
        bgGradientTop = Color(0xFF0E1F19),
        bgGradientBottom = Color(0xFF050B09),
    )

    val Tokyo = VibeTheme(
        id = "tokyo",
        name = "Tokyo Night",
        bgPrimary = Color(0xFF16161E),
        bgCard = Color(0xFF1F2335),
        bgCardHigh = Color(0xFF292E47),
        border = Color(0xFF292E42),
        accent = Color(0xFF7AA2F7),
        accentHover = Color(0xFFBB9AF7),
        textMain = Color(0xFFC0CAF5),
        textMuted = Color(0xFF7DCFFF),
        bgGradientTop = Color(0xFF1F1F2B),
        bgGradientBottom = Color(0xFF0F0F15),
    )

    val Crimson = VibeTheme(
        id = "crimson",
        name = "Crimson Flame",
        bgPrimary = Color(0xFF140A0B),
        bgCard = Color(0xFF211113),
        bgCardHigh = Color(0xFF30191B),
        border = Color(0xFF3B1A1E),
        accent = Color(0xFFEF4444),
        accentHover = Color(0xFFF97316),
        textMain = Color(0xFFFEE2E2),
        textMuted = Color(0xFFFCA5A5),
        bgGradientTop = Color(0xFF1D0E10),
        bgGradientBottom = Color(0xFF0C0607),
    )

    val Amethyst = VibeTheme(
        id = "amethyst",
        name = "Royal Amethyst",
        bgPrimary = Color(0xFF130F1C),
        bgCard = Color(0xFF20182F),
        bgCardHigh = Color(0xFF2C2240),
        border = Color(0xFF3B2A56),
        accent = Color(0xFFA855F7),
        accentHover = Color(0xFFC084FC),
        textMain = Color(0xFFF3E8FF),
        textMuted = Color(0xFFD8B4FE),
        bgGradientTop = Color(0xFF1B1528),
        bgGradientBottom = Color(0xFF0C0912),
    )

    val Catppuccin = VibeTheme(
        id = "catppuccin",
        name = "Catppuccin Mocha",
        bgPrimary = Color(0xFF181825),
        bgCard = Color(0xFF1E1E2E),
        bgCardHigh = Color(0xFF28283D),
        border = Color(0xFF313244),
        accent = Color(0xFFB4BEFE),
        accentHover = Color(0xFFFAB387),
        textMain = Color(0xFFCDD6F4),
        textMuted = Color(0xFFA6ADC8),
        bgGradientTop = Color(0xFF202032),
        bgGradientBottom = Color(0xFF11111B),
    )

    val Dracula = VibeTheme(
        id = "dracula",
        name = "Dracula Classic",
        bgPrimary = Color(0xFF1E1F29),
        bgCard = Color(0xFF282A36),
        bgCardHigh = Color(0xFF383A4C),
        border = Color(0xFF44475A),
        accent = Color(0xFFFF79C6),
        accentHover = Color(0xFF50FA7B),
        textMain = Color(0xFFF8F8F2),
        textMuted = Color(0xFF6272A4),
        bgGradientTop = Color(0xFF252733),
        bgGradientBottom = Color(0xFF16171F),
    )

    val Nord = VibeTheme(
        id = "nord",
        name = "Nord Frost",
        bgPrimary = Color(0xFF242933),
        bgCard = Color(0xFF2E3440),
        bgCardHigh = Color(0xFF3B4252),
        border = Color(0xFF3B4252),
        accent = Color(0xFF88C0D0),
        accentHover = Color(0xFF81A1C1),
        textMain = Color(0xFFECEFF4),
        textMuted = Color(0xFFD8DEE9),
        bgGradientTop = Color(0xFF2B313D),
        bgGradientBottom = Color(0xFF1B1F27),
    )

    val Solarized = VibeTheme(
        id = "solarized",
        name = "Solarized Dark",
        bgPrimary = Color(0xFF00212B),
        bgCard = Color(0xFF073642),
        bgCardHigh = Color(0xFF0B4655),
        border = Color(0xFF0E4B5C),
        accent = Color(0xFF2AA198),
        accentHover = Color(0xFFB58900),
        textMain = Color(0xFFFDF6E3),
        textMuted = Color(0xFF93A1A1),
        bgGradientTop = Color(0xFF002B36),
        bgGradientBottom = Color(0xFF00171F),
    )

    val allThemes: List<VibeTheme> = listOf(
        Cyberpunk,
        Midnight,
        Synthwave,
        Emerald,
        Tokyo,
        Crimson,
        Amethyst,
        Catppuccin,
        Dracula,
        Nord,
        Solarized,
    )

    val defaultTheme: VibeTheme = Cyberpunk

    fun fromId(id: String?): VibeTheme {
        if (id.isNullOrBlank()) return defaultTheme
        return allThemes.find { it.id.equals(id, ignoreCase = true) } ?: defaultTheme
    }
}
