package com.vibecast.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val VibeBg = Color(0xFF0B0F14)
val VibeSurface = Color(0xFF131A22)
val VibeSurfaceHigh = Color(0xFF1A2430)
val VibeGreen = Color(0xFF4ADE80)
val VibeGreenDark = Color(0xFF16A34A)
val VibeText = Color(0xFFE6EDF3)
val VibeMuted = Color(0xFF8B98A5)
val VibeRed = Color(0xFFF87171)
val VibeAmber = Color(0xFFFBBF24)

private val VibeColors = darkColorScheme(
    primary = VibeGreen,
    onPrimary = Color(0xFF06210F),
    primaryContainer = VibeGreenDark,
    onPrimaryContainer = Color(0xFFE6FFEF),
    secondary = Color(0xFF67E8F9),
    onSecondary = Color(0xFF052027),
    background = VibeBg,
    onBackground = VibeText,
    surface = VibeSurface,
    onSurface = VibeText,
    surfaceVariant = VibeSurfaceHigh,
    onSurfaceVariant = VibeMuted,
    error = VibeRed,
    onError = Color(0xFF2A0606),
    outline = Color(0xFF2A3542),
)

@Composable
fun VibeCastTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(colorScheme = VibeColors, content = content)
}
