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

enum class TrackSort(val title: String, val shortTitle: String) {
    TITLE_ASC("По названию (А-Я)", "Название (А-Я)"),
    TITLE_DESC("По названию (Я-А)", "Название (Я-А)"),
    ARTIST_ASC("По артисту", "По артисту"),
    DURATION_DESC("Сначала длинные", "Длинные"),
    DURATION_ASC("Сначала короткие", "Короткие"),
    DATE_DESC("Сначала новые", "Сначала новые"),
    DATE_ASC("Сначала старые", "Сначала старые"),
}

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

    suspend fun getAvailableFolders(): List<FolderInfo> = withContext(Dispatchers.IO) {
        scanner.scanFolders()
    }

    fun getSelectedFolders(): Set<String> = tokenStore.getSelectedFolders()

    suspend fun setSelectedFolders(folders: Set<String>): ScanOutcome {
        tokenStore.setSelectedFolders(folders)
        return rescan()
    }

    suspend fun rescan(): ScanOutcome = withContext(Dispatchers.IO) {
        val selected = tokenStore.getSelectedFolders()
        val scanned = scanner.scan(if (selected.isNotEmpty()) selected else null)
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

    fun page(
        offset: Int,
        limit: Int,
        query: String?,
        sort: TrackSort = TrackSort.TITLE_ASC,
    ): TrackPage {
        val snapshot = entries
        var sequence = snapshot.asSequence()
        if (!query.isNullOrBlank()) {
            val needle = query.lowercase(Locale.ROOT)
            sequence = sequence.filter { entry ->
                val t: TrackDto = entry.track
                t.title.lowercase(Locale.ROOT).contains(needle) ||
                    t.artist.lowercase(Locale.ROOT).contains(needle) ||
                    t.album.lowercase(Locale.ROOT).contains(needle) ||
                    t.albumArtist?.lowercase(Locale.ROOT)?.contains(needle) == true
            }
        }

        val sorted = when (sort) {
            TrackSort.TITLE_ASC -> sequence.sortedWith { a, b ->
                String.CASE_INSENSITIVE_ORDER.compare(a.track.title, b.track.title)
            }
            TrackSort.TITLE_DESC -> sequence.sortedWith { a, b ->
                String.CASE_INSENSITIVE_ORDER.compare(b.track.title, a.track.title)
            }
            TrackSort.ARTIST_ASC -> sequence.sortedWith { a, b ->
                val cmp = String.CASE_INSENSITIVE_ORDER.compare(a.track.artist, b.track.artist)
                if (cmp != 0) cmp else String.CASE_INSENSITIVE_ORDER.compare(a.track.title, b.track.title)
            }
            TrackSort.DURATION_DESC -> sequence.sortedWith { a, b ->
                b.track.durationMs.compareTo(a.track.durationMs)
            }
            TrackSort.DURATION_ASC -> sequence.sortedWith { a, b ->
                a.track.durationMs.compareTo(b.track.durationMs)
            }
            TrackSort.DATE_DESC -> sequence.sortedWith { a, b ->
                b.track.dateModified.compareTo(a.track.dateModified)
            }
            TrackSort.DATE_ASC -> sequence.sortedWith { a, b ->
                a.track.dateModified.compareTo(b.track.dateModified)
            }
        }.toList()

        return TrackPage(
            tracks = sorted.drop(offset).take(limit).map { it.track },
            total = sorted.size,
        )
    }
}
