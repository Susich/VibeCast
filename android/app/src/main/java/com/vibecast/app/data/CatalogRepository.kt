package com.vibecast.app.data

import com.vibecast.shared.TrackDto
import com.vibecast.shared.TrackPage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.util.Locale

data class ScanOutcome(
    val trackCount: Int,
    val version: Long,
    val changed: Boolean,
)

/**
 * Каталог в памяти. Версия монотонно растёт при изменении множества треков.
 * Чтение из HTTP-сервера потокобезопасно за счёт immutable snapshot.
 */
class CatalogRepository(
    private val tokenStore: TokenStore,
    private val scanner: MediaStoreScanner,
) {
    @Volatile
    private var entries: List<MediaEntry> = emptyList()

    @Volatile
    private var entriesById: Map<String, MediaEntry> = emptyMap()

    private val _version = MutableStateFlow(tokenStore.catalogVersion.coerceAtLeast(0L))
    val versionFlow: StateFlow<Long> = _version.asStateFlow()

    private val _trackCount = MutableStateFlow(0)
    val trackCountFlow: StateFlow<Int> = _trackCount.asStateFlow()

    val version: Long get() = _version.value
    val trackCount: Int get() = _trackCount.value

    suspend fun rescan(): ScanOutcome = withContext(Dispatchers.IO) {
        val scanned = scanner.scan()
        val oldIds = entries.asSequence().map { it.track.id }.toHashSet()
        val newIds = scanned.asSequence().map { it.track.id }.toHashSet()
        val changed = oldIds != newIds

        entries = scanned
        entriesById = scanned.associateBy { it.track.id }
        _trackCount.value = scanned.size

        if (changed || version == 0L) {
            val next = if (version <= 0L) 1L else version + 1L
            tokenStore.catalogVersion = next
            _version.value = next
        }
        ScanOutcome(trackCount = scanned.size, version = version, changed = changed)
    }

    fun find(id: String): MediaEntry? = entriesById[id]

    fun page(offset: Int, limit: Int, query: String?): TrackPage {
        val snapshot = entries
        if (query.isNullOrBlank()) {
            return TrackPage(
                tracks = snapshot.drop(offset).take(limit).map { it.track },
                total = snapshot.size,
            )
        }
        val needle = query.lowercase(Locale.ROOT)
        val filtered = snapshot.filter { entry ->
            val t: TrackDto = entry.track
            t.title.lowercase(Locale.ROOT).contains(needle) ||
                t.artist.lowercase(Locale.ROOT).contains(needle) ||
                t.album.lowercase(Locale.ROOT).contains(needle) ||
                t.albumArtist?.lowercase(Locale.ROOT)?.contains(needle) == true
        }
        return TrackPage(
            tracks = filtered.drop(offset).take(limit).map { it.track },
            total = filtered.size,
        )
    }
}
