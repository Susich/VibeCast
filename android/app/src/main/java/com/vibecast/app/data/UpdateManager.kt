package com.vibecast.app.data

import com.vibecast.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class AppUpdateInfo(
    val hasUpdate: Boolean,
    val currentVersion: String,
    val latestVersion: String,
    val releaseUrl: String,
    val apkDownloadUrl: String?,
    val releaseNotes: String?,
)

object UpdateManager {
    const val GITHUB_REPO_URL = "https://github.com/Susich/VibeCast"
    private const val GITHUB_API_LATEST = "https://api.github.com/repos/Susich/VibeCast/releases/latest"

    suspend fun checkForUpdates(): Result<AppUpdateInfo> = withContext(Dispatchers.IO) {
        runCatching {
            val url = URL(GITHUB_API_LATEST)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 7_000
                readTimeout = 7_000
                setRequestProperty("User-Agent", "VibeCast-Android/${BuildConfig.VERSION_NAME}")
                setRequestProperty("Accept", "application/vnd.github.v3+json")
            }

            if (conn.responseCode == 404) {
                // Репозиторий или первый релиз ещё не опубликован
                return@runCatching AppUpdateInfo(
                    hasUpdate = false,
                    currentVersion = BuildConfig.VERSION_NAME,
                    latestVersion = BuildConfig.VERSION_NAME,
                    releaseUrl = GITHUB_REPO_URL,
                    apkDownloadUrl = null,
                    releaseNotes = "У вас установлена актуальная версия.",
                )
            }

            if (conn.responseCode != 200) {
                throw IllegalStateException("GitHub API вернул статус ${conn.responseCode}")
            }

            val text = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(text)
            val tagName = json.optString("tag_name", "").removePrefix("v").trim()
            val htmlUrl = json.optString("html_url", GITHUB_REPO_URL)
            val body = json.optString("body", "")

            var apkUrl: String? = null
            val assets = json.optJSONArray("assets")
            if (assets != null) {
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    val name = asset.optString("name", "")
                    if (name.endsWith(".apk", ignoreCase = true)) {
                        apkUrl = if (asset.has("browser_download_url")) asset.getString("browser_download_url") else null
                        break
                    }
                }
            }

            val currentVer = BuildConfig.VERSION_NAME.removePrefix("v").trim()
            val hasUpdate = isNewer(tagName, currentVer)

            AppUpdateInfo(
                hasUpdate = hasUpdate,
                currentVersion = currentVer,
                latestVersion = tagName.ifEmpty { currentVer },
                releaseUrl = htmlUrl,
                apkDownloadUrl = apkUrl ?: htmlUrl,
                releaseNotes = body.ifEmpty { null },
            )
        }
    }

    private fun isNewer(latest: String, current: String): Boolean {
        if (latest.isEmpty() || latest == current) return false
        val latestParts = latest.split('.').mapNotNull { it.toIntOrNull() }
        val currentParts = current.split('.').mapNotNull { it.toIntOrNull() }
        for (i in 0 until maxOf(latestParts.size, currentParts.size)) {
            val l = latestParts.getOrElse(i) { 0 }
            val c = currentParts.getOrElse(i) { 0 }
            if (l > c) return true
            if (l < c) return false
        }
        return false
    }
}
