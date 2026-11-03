package com.vibecast.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Modern Deep Cyber/Glass Theme Palette
val VibeBg = Color(0xFF090D14)
val VibeBgGradientTop = Color(0xFF0E1522)
val VibeBgGradientBottom = Color(0xFF06090E)

val VibeSurface = Color(0xFF111823)
val VibeSurfaceHigh = Color(0xFF172231)
val VibeSurfaceBorder = Color(0xFF223143)
val VibeGlassBorder = Color(0x334ADE80)

val VibeGreen = Color(0xFF4ADE80)
val VibeGreenDark = Color(0xFF16A34A)
val VibeCyan = Color(0xFF22D3EE)
val VibeCyanDark = Color(0xFF0891B2)

val VibeText = Color(0xFFF1F5F9)
val VibeMuted = Color(0xFF94A3B8)
val VibeTextDim = Color(0xFF64748B)

val VibeRed = Color(0xFFF87171)
val VibeAmber = Color(0xFFFBBF24)

private val VibeColors = darkColorScheme(
    primary = VibeGreen,
    onPrimary = Color(0xFF06210F),
    primaryContainer = VibeGreenDark,
    onPrimaryContainer = Color(0xFFE6FFEF),
    secondary = VibeCyan,
    onSecondary = Color(0xFF052027),
    background = VibeBg,
    onBackground = VibeText,
    surface = VibeSurface,
    onSurface = VibeText,
    surfaceVariant = VibeSurfaceHigh,
    onSurfaceVariant = VibeMuted,
    error = VibeRed,
    onError = Color(0xFF2A0606),
    outline = VibeSurfaceBorder,
)

@Composable
fun VibeCastTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(colorScheme = VibeColors, content = content)
}
