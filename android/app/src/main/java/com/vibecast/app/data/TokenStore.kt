package com.vibecast.app.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom
import java.util.Base64

/**
 * Токен и версия каталога. Токен — 32 случайных байта, Base64 URL-safe.
 * Секрет никогда не логируется.
 */
class TokenStore(context: Context) {

    private val appContext = context.applicationContext
    private val prefs: SharedPreferences = createPrefs()
    private val lock = Any()

    fun token(): String = synchronized(lock) {
        prefs.getString(KEY_TOKEN, null)
            ?.takeIf { it.isNotBlank() }
            ?: generateToken().also { prefs.edit().putString(KEY_TOKEN, it).apply() }
    }

    var catalogVersion: Long
        get() = prefs.getLong(KEY_VERSION, 0L)
        set(value) {
            prefs.edit().putLong(KEY_VERSION, value).apply()
        }

    fun getSelectedFolders(): Set<String> = synchronized(lock) {
        prefs.getStringSet(KEY_SELECTED_FOLDERS, emptySet()) ?: emptySet()
    }

    fun setSelectedFolders(folders: Set<String>) = synchronized(lock) {
        prefs.edit().putStringSet(KEY_SELECTED_FOLDERS, folders).apply()
    }

    private fun createPrefs(): SharedPreferences {
        return try {
            val masterKey = MasterKey.Builder(appContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                appContext,
                FILE_ENCRYPTED,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (t: Throwable) {
            Log.w(TAG, "EncryptedSharedPreferences недоступны, используется приватный fallback")
            appContext.getSharedPreferences(FILE_FALLBACK, Context.MODE_PRIVATE)
        }
    }

    private fun generateToken(): String {
        val bytes = ByteArray(TOKEN_BYTES)
        SecureRandom().nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    companion object {
        private const val TAG = "VibeCastToken"
        private const val FILE_ENCRYPTED = "vibecast_secure"
        private const val FILE_FALLBACK = "vibecast_private"
        private const val KEY_TOKEN = "bearer_token"
        private const val KEY_VERSION = "catalog_version"
        private const val KEY_SELECTED_FOLDERS = "selected_music_folders"
        private const val TOKEN_BYTES = 32
        const val DEFAULT_PORT = 8765
    }
}
