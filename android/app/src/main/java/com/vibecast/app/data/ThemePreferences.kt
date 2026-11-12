package com.vibecast.app.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.vibecast.app.ui.theme.VibeTheme
import com.vibecast.app.ui.theme.VibeThemes

object ThemePreferences {
    private const val PREFS_NAME = "vibecast_theme_prefs"
    private const val KEY_THEME_ID = "theme_id"

    var currentTheme by mutableStateOf(VibeThemes.defaultTheme)
        private set

    fun init(context: Context) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedId = prefs.getString(KEY_THEME_ID, null)
        currentTheme = VibeThemes.fromId(savedId)
    }

    fun setTheme(context: Context, theme: VibeTheme) {
        currentTheme = theme
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_THEME_ID, theme.id).apply()
    }
}
