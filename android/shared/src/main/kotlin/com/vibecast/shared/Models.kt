package com.vibecast.shared

import kotlinx.serialization.Serializable

/** Публичная модель трека. Единый контракт Android → ПК. */
@Serializable
data class TrackDto(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val albumArtist: String? = null,
    val durationMs: Long = 0,
    val mime: String = "audio/mpeg",
    val size: Long = 0,
    val trackNo: Int? = null,
    val year: Int? = null,
    val coverId: Long? = null,
    val dateModified: Long = 0,
)

@Serializable
data class LibraryPage(
    val version: Long,
    val total: Int,
    val offset: Int,
    val limit: Int,
    val tracks: List<TrackDto>,
)

@Serializable
data class HealthDto(
    val ok: Boolean = true,
    val app: String = "vibecast",
    val protocol: Int = PROTOCOL_VERSION,
    val deviceName: String,
    val catalogVersion: Long,
    val trackCount: Int,
) {
    companion object {
        const val PROTOCOL_VERSION = 1
    }
}

@Serializable
data class ErrorDto(val error: String)

/** Внутренний результат страницы каталога (не сериализуется). */
data class TrackPage(val tracks: List<TrackDto>, val total: Int)

data class CoverData(val bytes: ByteArray, val contentType: String)
