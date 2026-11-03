package com.vibecast.shared.server

import com.vibecast.shared.CoverData
import com.vibecast.shared.ErrorDto
import com.vibecast.shared.HealthDto
import com.vibecast.shared.LibraryPage
import com.vibecast.shared.PlayerStateDto
import com.vibecast.shared.RangeParser
import com.vibecast.shared.RangeRequest
import com.vibecast.shared.RemoteCommandDto
import com.vibecast.shared.TrackDto
import com.vibecast.shared.TrackPage
import com.vibecast.shared.BearerAuth
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream

/** Всё, что HTTP-слой должен получить от Android-платформы. */
interface VibeCastDataSource {
    val deviceName: String
    fun catalogVersion(): Long
    fun catalogPage(offset: Int, limit: Int, query: String?): TrackPage
    fun findTrack(id: String): TrackDto?
    fun openAudio(id: String): AudioSource?
    fun cover(trackId: String): CoverData?
}

/** Источник байтов с поддержкой произвольного смещения (ContentResolver). */
interface AudioSource : Closeable {
    val length: Long
    val contentType: String
    fun openStream(offset: Long): InputStream
}

data class ServerConfig(
    val token: String,
    val protocolVersion: Int = HealthDto.PROTOCOL_VERSION,
    val appVersion: String = "0.2.6",
    val requireAuth: Boolean = false,
)

/** Broadcast версии каталога подписчикам SSE. replay=1 отдаёт актуальную версию. */
class SseHub {
    private val _versions = MutableSharedFlow<Long>(
        replay = 1,
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val versions: SharedFlow<Long> = _versions.asSharedFlow()

    fun publish(version: Long) {
        _versions.tryEmit(version)
    }
}

/** Хаб управления воспроизведением: приём команд от телефона и трансляция на ПК через SSE. */
class RemoteControlHub {
    private val _commands = MutableSharedFlow<RemoteCommandDto>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val commands: SharedFlow<RemoteCommandDto> = _commands.asSharedFlow()

    private val _playerState = MutableSharedFlow<PlayerStateDto?>(
        replay = 1,
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val playerState: SharedFlow<PlayerStateDto?> = _playerState.asSharedFlow()

    @Volatile
    private var lastState: PlayerStateDto? = null

    init {
        _playerState.tryEmit(null)
    }

    fun currentState(): PlayerStateDto? = lastState

    fun sendCommand(cmd: RemoteCommandDto) {
        _commands.tryEmit(cmd)
    }

    fun updatePlayerState(state: PlayerStateDto) {
        lastState = state
        _playerState.tryEmit(state)
    }
}

fun sseVersionPayload(version: Long): String =
    "event: version\ndata: {\"version\":$version}\n\n"

const val SSE_HEARTBEAT: String = ": ping\n\n"

/**
 * Единый Ktor-модуль для телефона. Платформенные части — за интерфейсами,
 * поэтому модуль тестируется на JVM без Android.
 */
fun io.ktor.server.application.Application.vibeCastModule(
    data: VibeCastDataSource,
    config: ServerConfig,
    hub: SseHub,
    remoteHub: RemoteControlHub = RemoteControlHub(),
) {
    install(ContentNegotiation) {
        json(Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        })
    }

    routing {
        get("/health") {
            call.respond(
                HealthDto(
                    deviceName = data.deviceName,
                    catalogVersion = data.catalogVersion(),
                    trackCount = data.catalogPage(0, 1, null).total,
                    token = if (config.requireAuth) null else config.token,
                    tokenRequired = config.requireAuth,
                ),
            )
        }

        route("/library") {
            get {
                if (!call.authorized(config.token, config.requireAuth)) return@get
                val offset = call.request.queryParameters["offset"]?.toIntOrNull()?.coerceAtLeast(0) ?: 0
                val limit = (call.request.queryParameters["limit"]?.toIntOrNull() ?: 100).coerceIn(1, 1000)
                val query = call.request.queryParameters["q"]?.trim()?.takeIf { it.isNotEmpty() }
                val page = data.catalogPage(offset, limit, query)
                call.respond(
                    LibraryPage(
                        version = data.catalogVersion(),
                        total = page.total,
                        offset = offset,
                        limit = limit,
                        tracks = page.tracks,
                    ),
                )
            }
        }

        route("/audio/{id}") {
            get {
                if (!call.authorized(config.token, config.requireAuth)) return@get
                call.respondAudioTrack(data, config, headOnly = false)
            }
            head {
                if (!call.authorized(config.token, config.requireAuth)) return@head
                call.respondAudioTrack(data, config, headOnly = true)
            }
        }

        route("/cover/{id}") {
            get {
                if (!call.authorized(config.token, config.requireAuth)) return@get
                val id = call.parameters["id"] ?: return@get call.respondNotFound()
                val cover = data.cover(id) ?: return@get call.respondNotFound()
                call.response.header(HttpHeaders.CacheControl, "public, max-age=86400")
                call.respondBytes(
                    bytes = cover.bytes,
                    contentType = safeContentType(cover.contentType),
                    status = HttpStatusCode.OK,
                )
            }
        }

        get("/events") {
            if (!call.authorized(config.token, config.requireAuth)) return@get
            call.response.header(HttpHeaders.CacheControl, "no-cache")
            call.response.header("X-Accel-Buffering", "no")
            call.respondTextWriter(ContentType.Text.EventStream) {
                var last = data.catalogVersion()
                write(sseVersionPayload(last))
                flush()
                while (true) {
                    val next = withTimeoutOrNull(15_000) {
                        hub.versions.first { it > last }
                    }
                    if (next == null) {
                        write(SSE_HEARTBEAT)
                        flush()
                    } else {
                        last = next
                        write(sseVersionPayload(next))
                        flush()
                    }
                }
            }
        }

        route("/remote") {
            // ПК передаёт текущий статус воспроизведения
            post("/state") {
                if (!call.authorized(config.token, config.requireAuth)) return@post
                val state = call.receive<PlayerStateDto>()
                remoteHub.updatePlayerState(state.copy(updatedAt = System.currentTimeMillis()))
                call.respond(HttpStatusCode.OK)
            }

            // Получить актуальный статус воспроизведения на ПК
            get("/state") {
                if (!call.authorized(config.token, config.requireAuth)) return@get
                val state = remoteHub.currentState() ?: PlayerStateDto()
                call.respond(state)
            }

            // Отправить команду на ПК (play, pause, next, prev, seek, volume, play_track)
            post("/command") {
                if (!call.authorized(config.token, config.requireAuth)) return@post
                val cmd = call.receive<RemoteCommandDto>()
                remoteHub.sendCommand(cmd)
                call.respond(HttpStatusCode.OK)
            }

            // SSE-поток для ПК: ПК слушает команды с телефона в реальном времени
            get("/events") {
                if (!call.authorized(config.token, config.requireAuth)) return@get
                call.response.header(HttpHeaders.CacheControl, "no-cache")
                call.response.header("X-Accel-Buffering", "no")
                call.respondTextWriter(ContentType.Text.EventStream) {
                    write(": ping\n\n")
                    flush()
                    val json = Json { ignoreUnknownKeys = true }
                    while (true) {
                        val cmd = withTimeoutOrNull(15_000) {
                            remoteHub.commands.first()
                        }
                        if (cmd == null) {
                            write(SSE_HEARTBEAT)
                            flush()
                        } else {
                            val payload = json.encodeToString(RemoteCommandDto.serializer(), cmd)
                            write("data: $payload\n\n")
                            flush()
                        }
                    }
                }
            }
        }
    }
}

private suspend fun ApplicationCall.authorized(expectedToken: String, requireAuth: Boolean = false): Boolean {
    if (!requireAuth) return true
    if (BearerAuth.matches(request.headers[HttpHeaders.Authorization], expectedToken)) return true
    respond(HttpStatusCode.Unauthorized, ErrorDto("unauthorized"))
    return false
}

private suspend fun ApplicationCall.respondNotFound() {
    respond(HttpStatusCode.NotFound, ErrorDto("not_found"))
}

private suspend fun ApplicationCall.respondAudioTrack(
    data: VibeCastDataSource,
    config: ServerConfig,
    headOnly: Boolean,
) {
    val id = parameters["id"] ?: return respondNotFound()
    val source = try {
        data.openAudio(id)
    } catch (t: Throwable) {
        if (t is CancellationException) throw t
        null
    } ?: return respondNotFound()

    try {
        val length = source.length
        val range = RangeParser.parse(request.headers[HttpHeaders.Range], length)
        response.header(HttpHeaders.AcceptRanges, "bytes")
        when (range) {
            RangeRequest.Full -> {
                if (headOnly) {
                    response.header(HttpHeaders.ContentLength, length)
                    respond(HttpStatusCode.OK)
                } else {
                    respondOutputStream(
                        contentType = safeContentType(source.contentType),
                        status = HttpStatusCode.OK,
                        contentLength = length,
                    ) {
                        source.openStream(0).use { input -> input.copyExactly(this, length) }
                    }
                }
            }

            is RangeRequest.Partial -> {
                val partLength = range.endInclusive - range.start + 1
                response.header(
                    HttpHeaders.ContentRange,
                    "bytes ${range.start}-${range.endInclusive}/$length",
                )
                if (headOnly) {
                    response.header(HttpHeaders.ContentLength, partLength)
                    respond(HttpStatusCode.PartialContent)
                } else {
                    respondOutputStream(
                        contentType = safeContentType(source.contentType),
                        status = HttpStatusCode.PartialContent,
                        contentLength = partLength,
                    ) {
                        source.openStream(range.start).use { input ->
                            input.copyExactly(this, partLength)
                        }
                    }
                }
            }

            is RangeRequest.Unsatisfiable -> {
                response.header(HttpHeaders.ContentRange, "bytes */$length")
                respond(HttpStatusCode.RequestedRangeNotSatisfiable, ErrorDto("range_not_satisfiable"))
            }
        }
    } finally {
        try {
            source.close()
        } catch (_: Throwable) {
            // закрытие источника не должно ломать ответ
        }
    }
}

private fun safeContentType(raw: String): ContentType =
    try {
        ContentType.parse(raw)
    } catch (_: Throwable) {
        ContentType.Application.OctetStream
    }

private fun InputStream.copyExactly(out: OutputStream, limit: Long) {
    val buffer = ByteArray(64 * 1024)
    var remaining = limit
    while (remaining > 0) {
        val want = minOf(buffer.size.toLong(), remaining).toInt()
        val read = read(buffer, 0, want)
        if (read <= 0) break
        out.write(buffer, 0, read)
        remaining -= read
    }
    out.flush()
}

@Suppress("unused")
private suspend fun ApplicationCall.respondRaw(bytes: ByteArray): Unit =
    respondBytes(bytes, ContentType.Application.OctetStream)
