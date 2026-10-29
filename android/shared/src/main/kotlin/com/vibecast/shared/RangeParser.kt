package com.vibecast.shared

import java.security.MessageDigest

/** Разбор одного Range-заголовка (bytes=...). Multi-range сознательно не поддержан. */
sealed interface RangeRequest {
    data object Full : RangeRequest
    data class Partial(val start: Long, val endInclusive: Long) : RangeRequest
    data class Unsatisfiable(val length: Long) : RangeRequest
}

object RangeParser {

    fun parse(header: String?, length: Long): RangeRequest {
        if (header.isNullOrBlank()) return RangeRequest.Full
        val value = header.trim()
        if (!value.startsWith("bytes=", ignoreCase = true)) return RangeRequest.Full

        val spec = value.substringAfter('=').trim()
        if (spec.isEmpty() || spec.contains(',')) return RangeRequest.Full
        if (length <= 0) return RangeRequest.Unsatisfiable(length)

        val dash = spec.indexOf('-')
        if (dash < 0) return RangeRequest.Full
        val startPart = spec.substring(0, dash).trim()
        val endPart = spec.substring(dash + 1).trim()

        return when {
            startPart.isEmpty() -> parseSuffix(endPart, length)
            else -> parseExplicit(startPart, endPart, length)
        }
    }

    private fun parseSuffix(suffixPart: String, length: Long): RangeRequest {
        val suffix = suffixPart.toLongOrNull() ?: return RangeRequest.Full
        if (suffix <= 0) return RangeRequest.Full
        val start = (length - suffix).coerceAtLeast(0)
        return RangeRequest.Partial(start, length - 1)
    }

    private fun parseExplicit(startPart: String, endPart: String, length: Long): RangeRequest {
        val start = startPart.toLongOrNull() ?: return RangeRequest.Full
        if (start < 0) return RangeRequest.Full
        if (start >= length) return RangeRequest.Unsatisfiable(length)

        if (endPart.isEmpty()) return RangeRequest.Partial(start, length - 1)
        val end = endPart.toLongOrNull() ?: return RangeRequest.Full
        if (end < start) return RangeRequest.Full
        return RangeRequest.Partial(start, end.coerceAtMost(length - 1))
    }
}

/** Bearer-токен: разбор и сравнение без раннего выхода (constant-time). */
object BearerAuth {

    fun extract(header: String?): String? {
        if (header == null) return null
        val trimmed = header.trim()
        if (trimmed.length < 7) return null
        if (!trimmed.regionMatches(0, "Bearer ", 0, 7, ignoreCase = true)) return null
        return trimmed.substring(7).trim().takeIf { it.isNotEmpty() }
    }

    fun matches(header: String?, expected: String): Boolean {
        val presented = extract(header) ?: return false
        val a = expected.toByteArray(Charsets.UTF_8)
        val b = presented.toByteArray(Charsets.UTF_8)
        if (a.size != b.size) return false
        return MessageDigest.isEqual(a, b)
    }
}

/** Формирование и разбор URL подключения из QR. */
object ConnectionUrl {

    fun build(host: String, port: Int, token: String): String =
        "http://$host:$port/#token=$token"

    /**
     * Возвращает baseUrl без fragment и токен, если он был в fragment/query.
     * Поддерживает http://host:port/#token=..., http://host:port?token=...
     */
    fun parse(input: String): ParsedConnection? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null
        val withoutFragment = trimmed.substringBefore('#')
        val fragment = trimmed.substringAfter('#', "")
        val queryIndex = withoutFragment.indexOf('?')
        val base = (if (queryIndex >= 0) withoutFragment.substring(0, queryIndex) else withoutFragment)
            .trimEnd('/')
            .takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?: return null
        val token = when {
            fragment.startsWith("token=") -> fragment.removePrefix("token=")
            queryIndex >= 0 -> {
                val query = withoutFragment.substring(queryIndex + 1)
                query.split('&')
                    .firstOrNull { it.startsWith("token=") }
                    ?.removePrefix("token=")
                    ?: ""
            }
            else -> ""
        }.trim()
        return ParsedConnection(baseUrl = base, token = token.takeIf { it.isNotEmpty() })
    }

    data class ParsedConnection(val baseUrl: String, val token: String?)
}
