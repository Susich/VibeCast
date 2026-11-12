package com.vibecast.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import com.vibecast.app.data.ThemePreferences

val LocalVibeTheme = staticCompositionLocalOf { VibeThemes.defaultTheme }

// Dynamic theme colors accessible anywhere inside Composables
val VibeBg: Color @Composable get() = LocalVibeTheme.current.bgPrimary
val VibeBgGradientTop: Color @Composable get() = LocalVibeTheme.current.bgGradientTop
val VibeBgGradientBottom: Color @Composable get() = LocalVibeTheme.current.bgGradientBottom

val VibeSurface: Color @Composable get() = LocalVibeTheme.current.bgCard
val VibeSurfaceHigh: Color @Composable get() = LocalVibeTheme.current.bgCardHigh
val VibeSurfaceBorder: Color @Composable get() = LocalVibeTheme.current.border
val VibeGlassBorder: Color @Composable get() = LocalVibeTheme.current.accent.copy(alpha = 0.25f)

val VibeGreen: Color @Composable get() = LocalVibeTheme.current.accent
val VibeGreenDark: Color @Composable get() = LocalVibeTheme.current.accentDark
val VibeCyan: Color @Composable get() = LocalVibeTheme.current.accentHover
val VibeCyanDark: Color @Composable get() = LocalVibeTheme.current.accentDark

val VibeText: Color @Composable get() = LocalVibeTheme.current.textMain
val VibeMuted: Color @Composable get() = LocalVibeTheme.current.textMuted
val VibeTextDim: Color @Composable get() = LocalVibeTheme.current.textDim

val VibeRed = Color(0xFFF87171)
val VibeAmber = Color(0xFFFBBF24)

@Composable
fun VibeCastTheme(
    theme: VibeTheme = ThemePreferences.currentTheme,
    content: @Composable () -> Unit,
) {
    val colors = darkColorScheme(
        primary = theme.accent,
        onPrimary = Color(0xFF06210F),
        primaryContainer = theme.accentDark,
        onPrimaryContainer = Color(0xFFE6FFEF),
        secondary = theme.accentHover,
        onSecondary = Color(0xFF052027),
        background = theme.bgPrimary,
        onBackground = theme.textMain,
        surface = theme.bgCard,
        onSurface = theme.textMain,
        surfaceVariant = theme.bgCardHigh,
        onSurfaceVariant = theme.textMuted,
        error = VibeRed,
        onError = Color(0xFF2A0606),
        outline = theme.border,
    )

    CompositionLocalProvider(LocalVibeTheme provides theme) {
        MaterialTheme(colorScheme = colors, content = content)
    }
}
