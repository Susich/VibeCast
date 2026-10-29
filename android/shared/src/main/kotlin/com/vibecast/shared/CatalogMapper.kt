package com.vibecast.shared

import java.security.MessageDigest
import java.util.Locale

/** Сырые поля, извлечённые из MediaStore. Не зависит от Android API. */
data class RawTrack(
    val mediaId: Long,
    val title: String?,
    val artist: String?,
    val album: String?,
    val albumArtist: String?,
    val albumId: Long?,
    val durationMs: Long,
    val size: Long,
    val dateModified: Long,
    val mimeType: String?,
    val trackNumber: Int?,
    val year: Int?,
    val displayName: String?,
)

/**
 * Чистый маппинг MediaStore → TrackDto.
 *
 * id = SHA-1("<mediaId>:<size>:<dateModified>") — стабилен между запусками и
 * меняется при замене файла. Обложка привязана к albumId.
 */
object CatalogMapper {

    fun map(raw: RawTrack): TrackDto {
        val fallbackTitle = raw.displayName
            ?.substringAfterLast('/')
            ?.substringBeforeLast('.', raw.displayName)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }

        val mime = normalizeMime(raw.mimeType, raw.displayName)
        return TrackDto(
            id = stableId(raw.mediaId, raw.size, raw.dateModified),
            title = raw.title.cleanOrNull() ?: fallbackTitle ?: "Без названия",
            artist = raw.artist.cleanOrNull() ?: "Неизвестный исполнитель",
            album = raw.album.cleanOrNull() ?: "Неизвестный альбом",
            albumArtist = raw.albumArtist.cleanOrNull(),
            durationMs = raw.durationMs.coerceAtLeast(0),
            mime = mime,
            size = raw.size.coerceAtLeast(0),
            trackNo = raw.trackNumber?.takeIf { it > 0 },
            year = raw.year?.takeIf { it > 0 },
            coverId = raw.albumId?.takeIf { it > 0 },
            dateModified = raw.dateModified,
        )
    }

    fun stableId(mediaId: Long, size: Long, dateModified: Long): String =
        sha1Hex("$mediaId:$size:$dateModified")

    fun normalizeMime(rawMime: String?, displayName: String?): String {
        val mime = rawMime?.trim()?.lowercase(Locale.ROOT)
        if (!mime.isNullOrEmpty() && mime.startsWith("audio/")) return mime
        return guessMime(displayName)
    }

    private fun guessMime(displayName: String?): String {
        val ext = extractExtension(displayName)
        return when (ext) {
            "mp3" -> "audio/mpeg"
            "flac" -> "audio/flac"
            "m4a", "mp4", "aac" -> "audio/mp4"
            "ogg", "oga" -> "audio/ogg"
            "opus" -> "audio/opus"
            "wav" -> "audio/wav"
            "wma" -> "audio/x-ms-wma"
            "aiff", "aif" -> "audio/aiff"
            else -> "audio/mpeg"
        }
    }

    private fun extractExtension(displayName: String?): String? =
        displayName
            ?.substringAfterLast('.', "")
            ?.lowercase(Locale.ROOT)
            ?.takeIf { it.isNotEmpty() }

    private fun String?.cleanOrNull(): String? =
        this?.trim()?.replace(Regex("\\s+"), " ")?.takeIf { it.isNotEmpty() }

    private fun sha1Hex(value: String): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(value.toByteArray(Charsets.UTF_8))
        val out = CharArray(digest.size * 2)
        val hex = "0123456789abcdef"
        digest.forEachIndexed { index, byte ->
            val v = byte.toInt() and 0xff
            out[index * 2] = hex[v ushr 4]
            out[index * 2 + 1] = hex[v and 0x0f]
        }
        return String(out)
    }
}
