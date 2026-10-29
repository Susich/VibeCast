package com.vibecast.shared

import com.vibecast.shared.server.sseVersionPayload
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CatalogMapperTest {

    private val base = RawTrack(
        mediaId = 42,
        title = "  Song   Name ",
        artist = "Artist",
        album = "Album",
        albumArtist = "Album Artist",
        albumId = 7,
        durationMs = 180_000,
        size = 5_000_000,
        dateModified = 1_700_000_000,
        mimeType = "audio/mpeg",
        trackNumber = 3,
        year = 2020,
        displayName = "song.mp3",
    )

    @Test
    fun `stable id is deterministic and depends on size and date`() {
        val a = CatalogMapper.map(base)
        val b = CatalogMapper.map(base.copy())
        assertEquals(a.id, b.id)
        assertEquals(40, a.id.length)

        assertNotEquals(a.id, CatalogMapper.map(base.copy(size = 5_000_001)).id)
        assertNotEquals(a.id, CatalogMapper.map(base.copy(dateModified = 1_700_000_001)).id)
    }

    @Test
    fun `fields are normalized and kept`() {
        val track = CatalogMapper.map(base)
        assertEquals("Song Name", track.title)
        assertEquals("Artist", track.artist)
        assertEquals("Album", track.album)
        assertEquals("audio/mpeg", track.mime)
        assertEquals(7L, track.coverId)
        assertEquals(3, track.trackNo)
        assertEquals(2020, track.year)
    }

    @Test
    fun `missing metadata gets readable fallbacks`() {
        val track = CatalogMapper.map(
            base.copy(
                title = "   ",
                artist = null,
                album = null,
                albumArtist = null,
                albumId = 0,
                mimeType = null,
                displayName = "My.Track.FLAC",
                trackNumber = 0,
                year = 0,
            ),
        )
        assertEquals("My.Track", track.title)
        assertEquals("Неизвестный исполнитель", track.artist)
        assertEquals("audio/flac", track.mime)
        assertNull(track.coverId)
        assertNull(track.trackNo)
        assertNull(track.year)
    }

    @Test
    fun `mime falls back to extension and defaults`() {
        assertEquals("audio/flac", CatalogMapper.normalizeMime(null, "a.flac"))
        assertEquals("audio/mp4", CatalogMapper.normalizeMime("", "a.m4a"))
        assertEquals("audio/ogg", CatalogMapper.normalizeMime("video/ogg", "a.ogg"))
        assertEquals("audio/mpeg", CatalogMapper.normalizeMime(null, "noext"))
        assertEquals("audio/wav", CatalogMapper.normalizeMime("AUDIO/WAV", "x"))
    }
}

class RangeParserTest {

    @Test
    fun `no header returns full`() {
        assertEquals(RangeRequest.Full, RangeParser.parse(null, 1000))
        assertEquals(RangeRequest.Full, RangeParser.parse("", 1000))
    }

    @Test
    fun `explicit range is clamped`() {
        assertEquals(RangeRequest.Partial(100, 200), RangeParser.parse("bytes=100-200", 1000))
        assertEquals(RangeRequest.Partial(100, 999), RangeParser.parse("bytes=100-5000", 1000))
    }

    @Test
    fun `open ended range`() {
        assertEquals(RangeRequest.Partial(100, 999), RangeParser.parse("bytes=100-", 1000))
    }

    @Test
    fun `suffix range`() {
        assertEquals(RangeRequest.Partial(900, 999), RangeParser.parse("bytes=-100", 1000))
        assertEquals(RangeRequest.Partial(0, 999), RangeParser.parse("bytes=-5000", 1000))
    }

    @Test
    fun `range beyond length is unsatisfiable`() {
        assertEquals(RangeRequest.Unsatisfiable(1000), RangeParser.parse("bytes=1000-", 1000))
        assertEquals(RangeRequest.Unsatisfiable(1000), RangeParser.parse("bytes=5000-6000", 1000))
    }

    @Test
    fun `malformed and multi ranges are ignored`() {
        assertEquals(RangeRequest.Full, RangeParser.parse("bytes=abc-def", 1000))
        assertEquals(RangeRequest.Full, RangeParser.parse("items=0-10", 1000))
        assertEquals(RangeRequest.Full, RangeParser.parse("bytes=0-10,20-30", 1000))
        assertEquals(RangeRequest.Full, RangeParser.parse("bytes=300-200", 1000))
        assertEquals(RangeRequest.Unsatisfiable(0), RangeParser.parse("bytes=0-0", 0))
    }
}

class AuthAndUrlTest {

    @Test
    fun `bearer token comparison`() {
        assertTrue(BearerAuth.matches("Bearer secret-token", "secret-token"))
        assertTrue(BearerAuth.matches("bearer secret-token", "secret-token"))
        assertTrue(!BearerAuth.matches("Bearer wrong", "secret-token"))
        assertTrue(!BearerAuth.matches(null, "secret-token"))
        assertTrue(!BearerAuth.matches("Basic secret-token", "secret-token"))
        assertNull(BearerAuth.extract("Bearer "))
    }

    @Test
    fun `qr url roundtrip`() {
        val url = ConnectionUrl.build("192.168.1.5", 8765, "abc")
        assertEquals("http://192.168.1.5:8765/#token=abc", url)
        val parsed = ConnectionUrl.parse(url)!!
        assertEquals("http://192.168.1.5:8765", parsed.baseUrl)
        assertEquals("abc", parsed.token)
    }

    @Test
    fun `query token and plain url`() {
        assertEquals("t", ConnectionUrl.parse("http://host:1?token=t")!!.token)
        assertNull(ConnectionUrl.parse("http://host:1")!!.token)
        assertNull(ConnectionUrl.parse("ftp://host"))
        assertNull(ConnectionUrl.parse(""))
    }

    @Test
    fun `sse payload format`() {
        assertEquals("event: version\ndata: {\"version\":5}\n\n", sseVersionPayload(5))
    }
}
