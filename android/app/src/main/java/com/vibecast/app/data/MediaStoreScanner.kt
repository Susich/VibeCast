package com.vibecast.app.data

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.vibecast.shared.CatalogMapper
import com.vibecast.shared.RawTrack
import com.vibecast.shared.TrackDto
import java.io.File

/** Трек + платформенные данные, не попадающие в JSON. */
data class MediaEntry(
    val track: TrackDto,
    val mediaId: Long,
    val uri: Uri,
    val albumId: Long?,
    val folderPath: String = "",
    val folderName: String = "",
)

/** Информация о папке с аудиофайлами на устройстве. */
data class FolderInfo(
    val path: String,
    val name: String,
    val count: Int,
)

/** Чтение локальной библиотеки через MediaStore. */
class MediaStoreScanner(private val context: Context) {

    fun scan(selectedFolderPaths: Set<String>? = null): List<MediaEntry> {
        val resolver = context.contentResolver
        val hasAlbumArtist = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        val hasBucket = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

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
            add(MediaStore.Audio.Media.DATA)
            if (hasBucket) add(MediaStore.Audio.Media.BUCKET_DISPLAY_NAME)
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
            val dataIdx = c.getColumnIndex(MediaStore.Audio.Media.DATA)
            val bucketIdx = if (hasBucket) c.getColumnIndex(MediaStore.Audio.Media.BUCKET_DISPLAY_NAME) else -1

            while (c.moveToNext()) {
                val size = c.getLong(sizeIdx)
                if (size <= 0) continue
                val mediaId = c.getLong(idIdx)
                val albumId = c.getLong(albumIdIdx).takeIf { it > 0 }
                val filePath = if (dataIdx >= 0) c.getString(dataIdx).orEmpty() else ""
                val bucketName = if (bucketIdx >= 0) c.getString(bucketIdx) else null

                val parentFile = if (filePath.isNotBlank()) File(filePath).parentFile else null
                val folderName = bucketName?.takeIf { it.isNotBlank() }
                    ?: parentFile?.name
                    ?: "Основная"
                val folderPath = parentFile?.absolutePath ?: folderName

                if (!selectedFolderPaths.isNullOrEmpty()) {
                    if (folderPath !in selectedFolderPaths && folderName !in selectedFolderPaths) {
                        continue
                    }
                }

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
                result += MediaEntry(track, mediaId, uri, albumId, folderPath, folderName)
            }
        }
        result.sortWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.track.title })
        return result
    }

    /** Сканирует все доступные папки на устройстве, содержащие аудиофайлы. */
    fun scanFolders(): List<FolderInfo> {
        val resolver = context.contentResolver
        val hasBucket = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

        val projection = buildList {
            add(MediaStore.Audio.Media._ID)
            add(MediaStore.Audio.Media.SIZE)
            add(MediaStore.Audio.Media.DATA)
            if (hasBucket) add(MediaStore.Audio.Media.BUCKET_DISPLAY_NAME)
        }.toTypedArray()

        val cursor = resolver.query(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            projection,
            "${MediaStore.Audio.Media.SIZE} > 0",
            null,
            null,
        ) ?: return emptyList()

        val folderCounts = LinkedHashMap<String, Pair<String, Int>>() // path -> (name, count)
        cursor.use { c ->
            val sizeIdx = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val dataIdx = c.getColumnIndex(MediaStore.Audio.Media.DATA)
            val bucketIdx = if (hasBucket) c.getColumnIndex(MediaStore.Audio.Media.BUCKET_DISPLAY_NAME) else -1

            while (c.moveToNext()) {
                val size = c.getLong(sizeIdx)
                if (size <= 0) continue
                val filePath = if (dataIdx >= 0) c.getString(dataIdx).orEmpty() else ""
                val bucketName = if (bucketIdx >= 0) c.getString(bucketIdx) else null
                val parentFile = if (filePath.isNotBlank()) File(filePath).parentFile else null
                val name = bucketName?.takeIf { it.isNotBlank() } ?: parentFile?.name ?: "Основная"
                val path = parentFile?.absolutePath ?: name

                val current = folderCounts[path]
                val currentCount = current?.second ?: 0
                folderCounts[path] = Pair(name, currentCount + 1)
            }
        }

        return folderCounts.map { (path, pair) ->
            FolderInfo(path = path, name = pair.first, count = pair.second)
        }.sortedWith(compareByDescending<FolderInfo> { it.count }.thenBy { it.name })
    }
}
