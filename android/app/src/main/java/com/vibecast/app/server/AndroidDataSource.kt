package com.vibecast.app.server

import android.content.Context
import android.os.Build
import com.vibecast.app.data.CatalogRepository
import com.vibecast.app.data.CoverStore
import com.vibecast.shared.CoverData
import com.vibecast.shared.TrackDto
import com.vibecast.shared.TrackPage
import com.vibecast.shared.server.AudioSource
import com.vibecast.shared.server.VibeCastDataSource
import java.io.FileInputStream
import java.io.InputStream
import java.io.Closeable

/** Адаптер MediaStore/ContentResolver к тестируемому HTTP-модулю. */
class AndroidDataSource(
    private val context: Context,
    private val repository: CatalogRepository,
    private val covers: CoverStore,
) : VibeCastDataSource {

    override val deviceName: String =
        listOfNotNull(Build.MANUFACTURER?.takeIf { it.isNotBlank() }, Build.MODEL)
            .joinToString(" ")
            .trim()
            .ifBlank { "Android" }

    override fun catalogVersion(): Long = repository.version

    override fun catalogPage(offset: Int, limit: Int, query: String?): TrackPage =
        repository.page(offset, limit, query)

    override fun findTrack(id: String): TrackDto? = repository.find(id)?.track

    override fun openAudio(id: String): AudioSource? {
        val entry = repository.find(id) ?: return null
        val pfd = context.contentResolver.openFileDescriptor(entry.uri, "r") ?: return null
        return ContentUriAudioSource(
            source = pfd,
            fallbackSize = entry.track.size,
            mimeType = entry.track.mime,
        )
    }

    override fun cover(trackId: String): CoverData? = covers.cover(trackId)
}

/**
 * FileInputStream поверх ParcelFileDescriptor. На каждый Range-запрос создаётся
 * отдельный экземпляр; openStream(offset) делает реальный seek по каналу.
 */
private class ContentUriAudioSource(
    source: android.os.ParcelFileDescriptor,
    fallbackSize: Long,
    mimeType: String,
) : AudioSource, Closeable {

    private val descriptor = source
    private val stream = FileInputStream(source.fileDescriptor)

    override val length: Long = source.statSize.takeIf { it > 0 } ?: fallbackSize
    override val contentType: String = mimeType.ifBlank { "audio/mpeg" }

    override fun openStream(offset: Long): InputStream {
        stream.channel.position(offset)
        return stream
    }

    override fun close() {
        runCatching { stream.close() }
        runCatching { descriptor.close() }
    }
}
