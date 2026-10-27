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
    ALL("Your Mix"), VIDEOS("Watch"), ARTICLES("Stories");
    fun accepts(item: FeedItem): Boolean = when (this) {
        ALL -> item.playable || item.kind == "article" || item.kind == "social"
        VIDEOS -> item.playable
        ARTICLES -> item.kind == "article"
    }
}

enum class FeedMode(val title: String, val hint: String) {
    BALANCED("Balanced", "A varied selection of topics and publishers"),
    LATEST("Latest", "Recently published stories and videos first"),
    EXPLORE("Explore", "Less repetition and more unexpected discoveries")
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

/** Strip embedded RSS/Atom markup before rendering any metadata. */
object FeedText {
    fun plain(input: String): String {
        val decoded = input
            .replace("&lt;", "<").replace("&gt;", ">")
            .replace("&amp;", "&").replace("&quot;", "\"")
            .replace("&#39;", "'").replace("&#x27;", "'")
            .replace("&apos;", "'").replace("&nbsp;", " ")
        return decoded.replace(Regex("</?[A-Za-z][^>]*>"), "")
            .replace(Regex("\\s+"), " ").trim()
    }
}

/** Avoid an empty feed when the newest server page contains only previously seen posts. */
object FeedBackfill {
    private const val MAX_PASSES = 4
    private const val TARGET_UNSEEN = 8
    fun shouldContinue(passes: Int, availableKinds: Int, unseen: Int): Boolean =
        passes < MAX_PASSES && availableKinds > 0 && unseen < TARGET_UNSEEN
}

object FeedRanker {
    fun rank(
        items: List<FeedItem>,
        taste: Taste,
        filter: FeedFilter,
        mode: FeedMode = FeedMode.BALANCED,
        feedback: Map<String, Float> = emptyMap()
    ): List<FeedItem> {
        val distinct = items.distinctBy { it.id }.filter { filter.accepts(it) }
        val sorted = distinct.sortedWith(
            compareByDescending<FeedItem> { score(it, taste, mode, feedback) }
                .thenByDescending { it.publishedAt }
                .thenBy { it.id }
        )
        if (filter != FeedFilter.ALL) return diversifySources(sorted)

        val videos = ArrayDeque(diversifySources(sorted.filter { it.playable }))
        val articles = ArrayDeque(diversifySources(sorted.filter { it.kind == "article" }))
        val social = ArrayDeque(diversifySources(sorted.filter { it.kind == "social" && isFreshSocial(it) }))
        // One community post every few cards, but never an endless social archive.
        val cycle = when (mode) {
            FeedMode.LATEST -> listOf(videos, articles, social, videos, articles)
            FeedMode.EXPLORE -> listOf(articles, videos, social, articles, videos)
            else -> listOf(videos, articles, videos, social, articles)
        }
        val result = ArrayList<FeedItem>(sorted.size)
        while (videos.isNotEmpty() || articles.isNotEmpty() || social.isNotEmpty()) {
            var progress = false
            for (pool in cycle) {
                if (pool.isNotEmpty()) { result.add(pool.removeFirst()); progress = true }
            }
            if (!progress) break
        }
        return result
    }

    internal fun isFreshSocial(item: FeedItem, now: Instant = Instant.now()): Boolean =
        runCatching {
            val age = java.time.Duration.between(Instant.parse(item.publishedAt), now)
            !age.isNegative && age.toDays() < 10
        }.getOrDefault(false)

    /** Greedy interleave: avoid repeating both the same publisher and topic when possible. */
    internal fun diversifySources(items: List<FeedItem>): List<FeedItem> {
        val pending = items.toMutableList()
        val output = ArrayList<FeedItem>(pending.size)
        var previousSource: String? = null
        var previousTopic: String? = null
        while (pending.isNotEmpty()) {
            val preferred = pending.indexOfFirst {
                sourceKey(it) != previousSource && it.bucket != previousTopic
            }
            val nextIndex = if (preferred >= 0) preferred else {
                val differentSource = pending.indexOfFirst { sourceKey(it) != previousSource }
                if (differentSource >= 0) differentSource else {
                    pending.indexOfFirst { it.bucket != previousTopic }.coerceAtLeast(0)
                }
            }
            val next = pending.removeAt(nextIndex)
            output.add(next)
            previousSource = sourceKey(next)
            previousTopic = next.bucket
        }
        return output
    }

    internal fun sourceKey(item: FeedItem): String =
        runCatching { java.net.URI(item.permalink).host }.getOrNull()
            ?.lowercase()?.removePrefix("www.")?.takeIf { it.isNotBlank() }
            ?: item.author.ifBlank { item.id }

    internal fun score(
        item: FeedItem,
        taste: Taste,
        mode: FeedMode = FeedMode.BALANCED,
        feedback: Map<String, Float> = emptyMap()
    ): Double {
        val videoBoost = if (item.playable) taste.shorts.toDouble() * 0.75 else 0.0
        val topicBoost = taste.weight(item) * 0.95
        val personal = (feedback["topic:" + item.bucket] ?: 0f).toDouble() * 1.2 +
            (feedback["source:" + sourceKey(item)] ?: 0f).toDouble() * 0.7
        val quality = item.quality.coerceIn(0.0, 1.0) * 0.28 +
            item.visual.coerceIn(0.0, 1.0) * 0.2 +
            item.engagement.coerceIn(0.0, 1.0) * 0.18
        // Actual publication time; discovering an archived clip does not make it fresh.
        val ageHours = runCatching {
            (System.currentTimeMillis() - Instant.parse(item.publishedAt).toEpochMilli()) / 3600000.0
        }.getOrDefault(24.0 * 365.0)
        val fresh = when (mode) {
            FeedMode.LATEST -> 3.0 / (1.0 + max(0.0, ageHours) / 8.0)
            FeedMode.EXPLORE -> 0.8 / (1.0 + max(0.0, ageHours) / 72.0)
            else -> 1.35 / (1.0 + max(0.0, ageHours) / 30.0)
        }
        return videoBoost + topicBoost + personal + quality + fresh
    }
}
