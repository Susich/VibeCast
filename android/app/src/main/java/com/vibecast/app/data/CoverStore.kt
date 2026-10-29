package com.vibecast.app.data

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import com.vibecast.shared.CoverData
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Обложки: MediaStore thumbnail (API 29+), album art URI, embedded picture.
 * Результат кэшируется в filesDir/covers/{trackId}.
 */
class CoverStore(
    private val context: Context,
    private val repository: CatalogRepository,
) {
    private val cacheDir = File(context.filesDir, "covers").apply { mkdirs() }

    fun cover(trackId: String): CoverData? {
        val entry = repository.find(trackId) ?: return null
        val file = File(cacheDir, "$trackId.img")
        if (file.isFile && file.length() > 0) {
            val bytes = runCatching { file.readBytes() }.getOrNull()
            if (bytes != null && bytes.isNotEmpty()) {
                return CoverData(bytes, detectContentType(bytes))
            }
        }

        val bytes = load(entry) ?: return null
        if (bytes.isEmpty()) return null
        runCatching {
            val tmp = File(cacheDir, "$trackId.tmp")
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(file)) {
                tmp.copyTo(file, overwrite = true)
                tmp.delete()
            }
        }
        return CoverData(bytes, detectContentType(bytes))
    }

    private fun load(entry: MediaEntry): ByteArray? {
        loadThumbnail(entry.uri)?.let { return it }
        entry.albumId?.let { albumId -> loadAlbumArt(albumId)?.let { return it } }
        return loadEmbedded(entry.uri)
    }

    private fun loadThumbnail(uri: Uri): ByteArray? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return runCatching {
            val bitmap = context.contentResolver.loadThumbnail(uri, Size(640, 640), null)
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
            bitmap.recycle()
            out.toByteArray()
        }.getOrNull()
    }

    private fun loadAlbumArt(albumId: Long): ByteArray? {
        val uri = android.content.ContentUris.withAppendedId(
            MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI,
            albumId,
        )
        return runCatching {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        }.getOrNull()?.takeIf { it.isNotEmpty() }
    }

    private fun loadEmbedded(uri: Uri): ByteArray? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            retriever.embeddedPicture?.takeIf { it.isNotEmpty() }
        } catch (_: Throwable) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    private fun detectContentType(bytes: ByteArray): String = when {
        bytes.size >= 3 &&
            bytes[0] == 0xFF.toByte() &&
            bytes[1] == 0xD8.toByte() &&
            bytes[2] == 0xFF.toByte() -> "image/jpeg"
        bytes.size >= 8 &&
            bytes[0] == 0x89.toByte() &&
            bytes[1] == 0x50.toByte() &&
            bytes[2] == 0x4E.toByte() &&
            bytes[3] == 0x47.toByte() -> "image/png"
        bytes.size >= 12 &&
            bytes[0] == 'R'.code.toByte() &&
            bytes[8] == 'W'.code.toByte() -> "image/webp"
        else -> "image/jpeg"
    }
}
