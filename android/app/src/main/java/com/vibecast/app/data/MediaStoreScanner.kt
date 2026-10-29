package com.vibecast.app.data

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.vibecast.shared.CatalogMapper
import com.vibecast.shared.RawTrack
import com.vibecast.shared.TrackDto

/** Трек + платформенные данные, не попадающие в JSON. */
data class MediaEntry(
    val track: TrackDto,
    val mediaId: Long,
    val uri: Uri,
    val albumId: Long?,
)

/** Чтение локальной библиотеки через MediaStore. */
class MediaStoreScanner(private val context: Context) {

    fun scan(): List<MediaEntry> {
        val resolver = context.contentResolver
        val hasAlbumArtist = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R

        val projection = buildList {
            add(MediaStore.Audio.Media._ID)
            add(MediaStore.Audio.Media.TITLE)
            add(MediaStore.Audio.Media.ARTIST)
            add(MediaStore.Audio.Media.ALBUM)
            add(MediaStore.Audio.Media.ALBUM_ID)
            add(MediaStore.Audio.Media.DURATION)
            add(MediaStore.Audio.Media.SIZE)
            add(MediaStore.Audio.Media.DATE_MODIFIED)
            add(MediaStore.Audio.Media.MIME_TYPE)
            add(MediaStore.Audio.Media.TRACK)
            add(MediaStore.Audio.Media.YEAR)
            add(MediaStore.Audio.Media.DISPLAY_NAME)
            if (hasAlbumArtist) add(MediaStore.Audio.Media.ALBUM_ARTIST)
        }.toTypedArray()

        val cursor = resolver.query(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            projection,
            "${MediaStore.Audio.Media.SIZE} > 0",
            null,
            "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC",
        ) ?: return emptyList()

        val result = ArrayList<MediaEntry>(256)
        cursor.use { c ->
            val idIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val titleIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val albumIdIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
            val albumArtistIdx =
                if (hasAlbumArtist) c.getColumnIndex(MediaStore.Audio.Media.ALBUM_ARTIST) else -1
            val durationIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val sizeIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val modifiedIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
            val mimeIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
            val trackIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
            val yearIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
            val displayIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)

            while (c.moveToNext()) {
                val size = c.getLong(sizeIdx)
                if (size <= 0) continue
                val mediaId = c.getLong(idIdx)
                val albumId = c.getLong(albumIdIdx).takeIf { it > 0 }
                val raw = RawTrack(
                    mediaId = mediaId,
                    title = c.getString(titleIdx),
                    artist = c.getString(artistIdx),
                    album = c.getString(albumIdx),
                    albumArtist = if (albumArtistIdx >= 0) c.getString(albumArtistIdx) else null,
                    albumId = albumId,
                    durationMs = c.getLong(durationIdx),
                    size = size,
                    dateModified = c.getLong(modifiedIdx),
                    mimeType = c.getString(mimeIdx),
                    trackNumber = c.getInt(trackIdx),
                    year = c.getInt(yearIdx),
                    displayName = c.getString(displayIdx),
                )
                val track = CatalogMapper.map(raw)
                val uri = ContentUris.withAppendedId(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    mediaId,
                )
                result += MediaEntry(track, mediaId, uri, albumId)
            }
        }
        result.sortWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.track.title })
        return result
    }
}
