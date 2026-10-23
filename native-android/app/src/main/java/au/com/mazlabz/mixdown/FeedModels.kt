package au.com.mazlabz.mixdown

import java.time.Instant
import kotlin.math.max

data class FeedItem(
    val id: String,
    val kind: String,
    val title: String,
    val author: String,
    val permalink: String,
    val bucket: String,
    val mediaUrl: String,
    val mediaKind: String,
    val posterUrl: String,
    val excerpt: String,
    val body: List<String>,
    val publishedAt: String,
    val ingestedAt: String,
    val quality: Double,
    val visual: Double,
    val engagement: Double,
    val isNsfw: Boolean
) {
    val playable: Boolean get() = kind == "video" &&
        (mediaKind == "mp4" || mediaKind == "hls") &&
        mediaUrl.startsWith("https://")
}

enum class FeedFilter(val title: String) {
    ALL("For you"), VIDEOS("Clips"), ARTICLES("Read"), SOCIAL("Social");
    fun accepts(item: FeedItem): Boolean = when (this) {
        ALL -> true
        VIDEOS -> item.playable
        ARTICLES -> item.kind == "article"
        SOCIAL -> item.kind == "social"
    }
}

data class Taste(
    val tech: Float = 0.80f,
    val entertainment: Float = 0.85f,
    val comedy: Float = 0.85f,
    val shorts: Float = 0.95f
) {
    fun weight(item: FeedItem): Double = when (item.bucket) {
        "software-depth", "making", "science", "language", "news-analysis" -> tech.toDouble()
        "entertainment", "visual-culture" -> entertainment.toDouble()
        "internet", "quick-hits" -> comedy.toDouble()
        else -> 0.50
    }
}

object FeedRanker {
    fun rank(items: List<FeedItem>, taste: Taste, filter: FeedFilter): List<FeedItem> {
        val distinct = items.distinctBy { it.id }.filter { filter.accepts(it) }
        val sorted = distinct.sortedWith(
            compareByDescending<FeedItem> { score(it, taste) }
                .thenByDescending { it.ingestedAt }
                .thenBy { it.id }
        )
        if (filter != FeedFilter.ALL) return sorted

        val videos = ArrayDeque(diversifySources(sorted.filter { it.playable }))
        val articles = ArrayDeque(diversifySources(sorted.filter { it.kind == "article" }))
        val socials = ArrayDeque(diversifySources(sorted.filter { it.kind == "social" && isFreshSocial(it) }))
        // Preserve a mixed feed regardless of the imbalance in ingestion volume.
        val cycle = listOf(videos, articles, videos, socials, videos, articles, videos)
        val result = ArrayList<FeedItem>(sorted.size)
        while (videos.isNotEmpty() || articles.isNotEmpty() || socials.isNotEmpty()) {
            var progress = false
            for (pool in cycle) {
                if (pool.isNotEmpty()) {
                    result.add(pool.removeFirst())
                    progress = true
                }
            }
            if (!progress) break
        }
        return result
    }

    // Do not interleave weeks-old community posts into a supposedly current
    // For You feed. The dedicated Social tab still exposes the full archive.
    internal fun isFreshSocial(item: FeedItem, now: Instant = Instant.now()): Boolean =
        runCatching {
            val age = java.time.Duration.between(Instant.parse(item.ingestedAt), now)
            !age.isNegative && age.toDays() < 14
        }.getOrDefault(false)

    // Interleave publishers within each content pool while preserving each publisher's ranking.
    // Remaining items from one source still appear rather than being silently dropped.
    internal fun diversifySources(items: List<FeedItem>): List<FeedItem> {
        val pending = items.toMutableList()
        val output = ArrayList<FeedItem>(pending.size)
        var previousSource: String? = null
        while (pending.isNotEmpty()) {
            val nextIndex = pending.indexOfFirst { sourceKey(it) != previousSource }
                .let { if (it < 0) 0 else it }
            val next = pending.removeAt(nextIndex)
            output.add(next)
            previousSource = sourceKey(next)
        }
        return output
    }

    private fun sourceKey(item: FeedItem): String {
        val host = runCatching { java.net.URI(item.permalink).host }
            .getOrNull()?.lowercase()?.removePrefix("www.")
        return host?.takeIf { it.isNotBlank() }
            ?: item.author.ifBlank { item.id }
    }

    internal fun score(item: FeedItem, taste: Taste): Double {
        val videoBoost = if (item.playable) taste.shorts.toDouble() * 0.90 else 0.0
        val topicBoost = taste.weight(item) * 1.25
        val quality = item.quality.coerceIn(0.0, 1.0) * 0.24 +
            item.visual.coerceIn(0.0, 1.0) * 0.24 +
            item.engagement.coerceIn(0.0, 1.0) * 0.18
        val ageHours = runCatching {
            (System.currentTimeMillis() - Instant.parse(item.ingestedAt).toEpochMilli()) / 3600000.0
        }.getOrDefault(72.0)
        val fresh = 0.25 / (1.0 + max(0.0, ageHours) / 36.0)
        return videoBoost + topicBoost + quality + fresh
    }
}
