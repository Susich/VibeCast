package com.vibecast.shared

import com.vibecast.shared.server.AudioSource
import com.vibecast.shared.server.ServerConfig
import com.vibecast.shared.server.SseHub
import com.vibecast.shared.server.VibeCastDataSource
import com.vibecast.shared.server.vibeCastModule
import io.ktor.client.request.get
import io.ktor.client.request.head
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import java.io.ByteArrayInputStream
import java.io.InputStream
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ServerIntegrationTest {

    private val token = "test-token-0123456789"
    private val audioBytes = ByteArray(1000) { (it % 256).toByte() }

    private val tracks = listOf(
        track("t1", "Alpha", "Artist One", "Album A"),
        track("t2", "Beta", "Artist Two", "Album B"),
        track("t3", "Gamma", "Artist One", "Album A"),
        track("t4", "Two Words", "Artist Three", "Album C"),
        track("t5", "Delta", "Artist Two", "Album B"),
    )

    private val data = FakeDataSource(tracks, audioBytes)

    private fun withServer(block: suspend io.ktor.server.testing.ApplicationTestBuilder.() -> Unit) =
        testApplication {
            application { vibeCastModule(data, ServerConfig(token = token, requireAuth = true), SseHub()) }
            block()
        }

    @Test
    fun `health is public and does not expose token`() = withServer {
        val response = client.get("/health")
        assertEquals(HttpStatusCode.OK, response.status)
        val text = response.bodyAsText()
        assertTrue(text.contains("\"ok\":true"), text)
        assertTrue(!text.contains(token), "health must not expose the token")
        val health = Json.decodeFromString<HealthDto>(text)
        assertEquals(5, health.trackCount)
        assertEquals(7, health.catalogVersion)
    }

    @Test
    fun `library requires bearer token`() = withServer {
        assertEquals(HttpStatusCode.Unauthorized, client.get("/library").status)
        assertEquals(
            HttpStatusCode.Unauthorized,
            client.get("/library") { header(HttpHeaders.Authorization, "Bearer wrong") }.status,
        )
        val ok = client.get("/library") { header(HttpHeaders.Authorization, "Bearer $token") }
        assertEquals(HttpStatusCode.OK, ok.status)
    }

    @Test
    fun `library paginates filters and reports total`() = withServer {
        val first = Json.decodeFromString<LibraryPage>(
            client.get("/library?offset=0&limit=2") { bearer() }.bodyAsText(),
        )
        assertEquals(5, first.total)
        assertEquals(2, first.tracks.size)
        assertEquals(listOf("t1", "t2"), first.tracks.map { it.id })
        assertEquals(7, first.version)

        val filtered = Json.decodeFromString<LibraryPage>(
            client.get("/library?q=two%20words") { bearer() }.bodyAsText(),
        )
        assertEquals(1, filtered.total)
        assertEquals("Two Words", filtered.tracks.single().title)

        val second = Json.decodeFromString<LibraryPage>(
            client.get("/library?offset=4&limit=2") { bearer() }.bodyAsText(),
        )
        assertEquals(listOf("t5"), second.tracks.map { it.id })
    }

    @Test
    fun `audio full response has length and accepts ranges`() = withServer {
        val full = client.get("/audio/t1") { bearer() }
        assertEquals(HttpStatusCode.OK, full.status)
        assertEquals("bytes", full.headers[HttpHeaders.AcceptRanges])
        assertEquals("1000", full.headers[HttpHeaders.ContentLength])
        assertEquals(ContentType.Audio.MPEG, full.contentType())
        assertContentEquals(audioBytes, full.bodyAsBytes())
    }

    @Test
    fun `audio range returns 206 with exact bytes`() = withServer {
        val response = client.get("/audio/t1") {
            bearer()
            header(HttpHeaders.Range, "bytes=100-200")
        }
        assertEquals(HttpStatusCode.PartialContent, response.status)
        assertEquals("bytes 100-200/1000", response.headers[HttpHeaders.ContentRange])
        assertEquals("101", response.headers[HttpHeaders.ContentLength])
        assertContentEquals(ByteArray(101) { ((100 + it) % 256).toByte() }, response.bodyAsBytes())
    }

    @Test
    fun `audio suffix range and head request`() = withServer {
        val suffix = client.get("/audio/t1") {
            bearer()
            header(HttpHeaders.Range, "bytes=-10")
        }
        assertEquals(HttpStatusCode.PartialContent, suffix.status)
        assertEquals(10, suffix.bodyAsBytes().size)

        val head = client.head("/audio/t1") { bearer() }
        assertEquals(HttpStatusCode.OK, head.status)
        assertEquals("1000", head.headers[HttpHeaders.ContentLength])
        assertEquals(0, head.bodyAsBytes().size)
    }

    @Test
    fun `audio invalid and unsatisfiable ranges`() = withServer {
        val ignored = client.get("/audio/t1") {
            bearer()
            header(HttpHeaders.Range, "bytes=0-10,20-30")
        }
        assertEquals(HttpStatusCode.OK, ignored.status)
        assertEquals(1000, ignored.bodyAsBytes().size)

        val bad = client.get("/audio/t1") {
            bearer()
            header(HttpHeaders.Range, "bytes=1000-")
        }
        assertEquals(HttpStatusCode.RequestedRangeNotSatisfiable, bad.status)
        assertEquals("bytes */1000", bad.headers[HttpHeaders.ContentRange])
    }

    @Test
    fun `cover requires token and returns bytes`() = withServer {
        assertEquals(HttpStatusCode.Unauthorized, client.get("/cover/t1").status)
        val response = client.get("/cover/t1") { bearer() }
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(ContentType.Image.PNG, response.contentType())
        assertContentEquals(byteArrayOf(1, 2, 3), response.bodyAsBytes())
    }

    @Test
    fun `unknown ids return 404`() = withServer {
        assertEquals(HttpStatusCode.NotFound, client.get("/audio/nope") { bearer() }.status)
        assertEquals(HttpStatusCode.NotFound, client.get("/cover/nope") { bearer() }.status)
    }

    private fun io.ktor.client.request.HttpRequestBuilder.bearer() {
        header(HttpHeaders.Authorization, "Bearer $token")
    }

    private fun track(id: String, title: String, artist: String, album: String) = TrackDto(
        id = id,
        title = title,
        artist = artist,
        album = album,
        durationMs = 1000,
        size = 1000,
        mime = "audio/mpeg",
    )

    private class FakeDataSource(
        private val tracks: List<TrackDto>,
        private val audio: ByteArray,
    ) : VibeCastDataSource {
        override val deviceName: String = "Fake Phone"

        override fun catalogVersion(): Long = 7

        override fun catalogPage(offset: Int, limit: Int, query: String?): TrackPage {
            val filtered = if (query.isNullOrBlank()) tracks else tracks.filter { track ->
                listOf(track.title, track.artist, track.album).any {
                    it.contains(query, ignoreCase = true)
                }
            }
            return TrackPage(
                tracks = filtered.drop(offset).take(limit),
                total = filtered.size,
            )
        }

        override fun findTrack(id: String): TrackDto? = tracks.firstOrNull { it.id == id }

        override fun openAudio(id: String): AudioSource? {
            if (tracks.none { it.id == id }) return null
            return object : AudioSource {
                override val length: Long = audio.size.toLong()
                override val contentType: String = "audio/mpeg"
                override fun openStream(offset: Long): InputStream =
                    ByteArrayInputStream(audio, offset.toInt(), audio.size - offset.toInt())
                override fun close() = Unit
            }
        }

        override fun cover(trackId: String): CoverData? =
            if (tracks.any { it.id == trackId }) CoverData(byteArrayOf(1, 2, 3), "image/png") else null
    }
}
