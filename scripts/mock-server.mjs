#!/usr/bin/env node
/*
 * Local VibeCast protocol fixture.
 *
 * Implements the same HTTP surface as the Android source so the desktop app
 * can be exercised without a phone:
 *   GET /health, /library, /audio/{id}, /cover/{id}, /events
 *   POST /debug/bump  (bumps catalog version and notifies SSE clients)
 *
 * Run: node scripts/mock-server.mjs [port]
 * Token: demo-token-123 (override with VIBECAST_TOKEN)
 */
import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { deflateSync } from "node:zlib";

const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const HOST = process.env.VIBECAST_HOST || "0.0.0.0";
const TOKEN = process.env.VIBECAST_TOKEN || "demo-token-123";
const VERSION_START = 3;

const TRACK_DEFS = [
  ["Город спит", "Полярный круг", "Ночной эфир", 220],
  ["Первый снег", "Полярный круг", "Ночной эфир", 247],
  ["Радиоволна", "Полярный круг", "Ночной эфир", 262],
  ["Двор", "Тихие дома", "Тихие дома", 294],
  ["Дом у реки", "Сосны", "Сосны", 330],
  ["Летний дождь", "Мятный чай", "Мятный чай", 349],
  ["Coastal Static", "Coastal Static", "Coastal Static", 392],
  ["Neon Harbour", "Neon Harbour", "Neon Harbour", 440],
];

const WAV = makeWav(22050, 8);
const TRACKS = TRACK_DEFS.map(([title, artist, album, freq], index) => {
  const id = String(index + 1).padStart(2, "0").repeat(20);
  return {
    id,
    title,
    artist,
    album,
    albumArtist: artist,
    durationMs: 8000,
    mime: "audio/wav",
    size: WAV.length,
    trackNo: (index % 3) + 1,
    year: 2026,
    coverId: index + 1,
    dateModified: 1760000000 + index,
    _freq: freq,
  };
});

const byId = new Map(TRACKS.map((track) => [track.id, track]));
let version = VERSION_START;
const sseClients = new Set();

function publicTrack(track) {
  const { _freq, ...rest } = track;
  return rest;
}

function makeWav(sampleRate, seconds) {
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const env = Math.min(1, t * 8, (seconds - t) * 8);
    const value = Math.sin(2 * Math.PI * 220 * t) * 0.25 * env;
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
}

function makeCover(track) {
  const size = 384;
  const hue = (Number(track.id.slice(0, 2)) * 23) % 360;
  const [r, g, b] = hsl(hue, 48, 38);
  const [r2, g2, b2] = hsl((hue + 48) % 360, 55, 22);
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const mix = (x + y) / (size * 2);
      const shade = 1 - (y / size) * 0.25;
      row[1 + x * 3] = Math.round((r * (1 - mix) + r2 * mix) * shade);
      row[2 + x * 3] = Math.round((g * (1 - mix) + g2 * mix) * shade);
      row[3 + x * 3] = Math.round((b * (1 - mix) + b2 * mix) * shade);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] :
    [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255));
}

const covers = new Map(TRACKS.map((track) => [track.id, makeCover(track)]));

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function serveAudio(req, res, track) {
  const total = WAV.length;
  const range = req.headers.range;
  const common = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  if (!range) {
    res.writeHead(200, { ...common, "Content-Length": total });
    res.end(req.method === "HEAD" ? undefined : WAV);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) {
    res.writeHead(416, { ...common, "Content-Range": `bytes */${total}` });
    res.end();
    return;
  }
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  }
  if (!Number.isFinite(start) || start >= total || start > end) {
    res.writeHead(416, { ...common, "Content-Range": `bytes */${total}` });
    res.end();
    return;
  }
  const chunk = WAV.subarray(start, end + 1);
  res.writeHead(206, {
    ...common,
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Content-Length": chunk.length,
  });
  res.end(req.method === "HEAD" ? undefined : chunk);
}

function broadcastVersion() {
  const payload = `event: version\ndata: ${JSON.stringify({ version })}\n\n`;
  for (const client of sseClients) client.write(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = decodeURIComponent(url.pathname);
  const started = Date.now();
  res.on("finish", () => {
    const status = res.statusCode;
    console.log(`${req.method} ${path} ${status} ${Date.now() - started}ms`);
  });

  if (path === "/health") {
    json(res, 200, {
      ok: true,
      app: "vibecast",
      protocol: 1,
      deviceName: "VibeCast Mock",
      catalogVersion: version,
      trackCount: TRACKS.length,
    });
    return;
  }

  if (path === "/debug/bump" && req.method === "POST") {
    if (!authorized(req)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    version += 1;
    broadcastVersion();
    json(res, 200, { version });
    return;
  }

  if (!authorized(req)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }

  if (path === "/library" && (req.method === "GET" || req.method === "HEAD")) {
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 500) || 500));
    const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
    const filtered = query
      ? TRACKS.filter((track) =>
          `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query),
        )
      : TRACKS;
    json(res, 200, {
      version,
      total: filtered.length,
      offset,
      limit,
      tracks: filtered.slice(offset, offset + limit).map(publicTrack),
    });
    return;
  }

  if (path === "/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: version\ndata: ${JSON.stringify({ version })}\n\n`);
    sseClients.add(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 10_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  const audioMatch = /^\/audio\/([a-f0-9]{40})$/.exec(path);
  if (audioMatch) {
    const track = byId.get(audioMatch[1]);
    if (!track) json(res, 404, { error: "not found" });
    else serveAudio(req, res, track);
    return;
  }

  const coverMatch = /^\/cover\/([a-f0-9]{40})$/.exec(path);
  if (coverMatch) {
    const cover = covers.get(coverMatch[1]);
    if (!cover) {
      json(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": cover.length,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(cover);
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`VibeCast mock: http://${HOST}:${PORT}`);
  console.log(`token: ${TOKEN}`);
  console.log(`catalog: ${TRACKS.length} tracks, version ${version}`);
  console.log(`connect URL: http://127.0.0.1:${PORT}/#token=${TOKEN}`);

  // Broadcast discovery beacon over UDP port 41234
  try {
    const udp = createSocket({ type: "udp4", reuseAddr: true });
    udp.bind(() => {
      udp.setBroadcast(true);
      const beaconMsg = Buffer.from(
        JSON.stringify({
          device_name: "Mock Phone (VibeCast)",
          service: "audio_stream",
          port: PORT,
          version: "1",
          token_required: true,
        })
      );
      const broadcast = () => {
        udp.send(beaconMsg, 41234, "255.255.255.255", () => {});
        udp.send(beaconMsg, 41234, "127.0.0.1", () => {});
      };
      broadcast();
      setInterval(broadcast, 3000);
      console.log(`broadcasting UDP discovery beacon on port 41234`);
    });
  } catch (err) {
    console.warn(`could not start UDP beacon broadcaster: ${err.message}`);
  }
});
