package au.com.mazlabz.mixdown

import android.content.Context
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.temporal.ChronoUnit

/** A server page can have fewer usable items than the number of rows retrieved. */
data class FeedBatch(val items: List<FeedItem>, val received: Int) {
    init { require(received >= items.size) { "The number of accepted rows cannot exceed raw rows" } }
    fun nextOffset(currentOffset: Int): Int = currentOffset + received
}

class FeedRepository(context: Context) {
    private val storage = context.getSharedPreferences("mixdown_2", Context.MODE_PRIVATE)

    var taste: Taste = Taste(
        tech = storage.getFloat("taste_tech", 0.80f),
        entertainment = storage.getFloat("taste_entertainment", 0.85f),
        comedy = storage.getFloat("taste_comedy", 0.85f),
        shorts = storage.getFloat("taste_shorts", 0.95f)
    )
        private set

    var muted: Boolean = storage.getBoolean("muted", true)
        private set

    var nsfw: Boolean = storage.getBoolean("nsfw", false)
        private set

    var mode: FeedMode = runCatching {
        FeedMode.valueOf(storage.getString("feed_mode", "BALANCED") ?: "BALANCED")
    }.getOrDefault(FeedMode.BALANCED)
        private set

    fun setMode(next: FeedMode) {
        mode = next
        storage.edit().putString("feed_mode", next.name).apply()
    }

    /** Personal preferences are learned per content pool; no hidden fixed user tastes. */
    fun feedbackWeights(): Map<String, Float> {
        val prefs = storage.getString("preference_" + nsfw, "{}") ?: "{}"
        val obj = runCatching { JSONObject(prefs) }.getOrDefault(JSONObject())
        val result = mutableMapOf<String, Float>()
        obj.keys().forEach { key ->
            result[key] = obj.optDouble(key, 0.0).toFloat().coerceIn(-1.5f, 1.5f)
        }
        return result
    }

    fun rate(item: FeedItem, more: Boolean) {
        require(item.isNsfw == nsfw)
        val key = "preference_" + nsfw
        val prefs = runCatching { JSONObject(storage.getString(key, "{}") ?: "{}") }
            .getOrDefault(JSONObject())
        val delta = if (more) 0.25f else -0.25f
        val keys = listOf("topic:" + item.bucket, "source:" + FeedRanker.sourceKey(item))
        keys.forEachIndexed { index, name ->
            val strength = if (index == 0) delta else delta * 0.6f
            prefs.put(name, (prefs.optDouble(name, 0.0) + strength).coerceIn(-1.5, 1.5))
        }
        storage.edit().putString(key, prefs.toString()).apply()
    }

    fun saveTaste(next: Taste) {
        taste = next
        storage.edit().putFloat("taste_tech", next.tech)
            .putFloat("taste_entertainment", next.entertainment)
            .putFloat("taste_comedy", next.comedy)
            .putFloat("taste_shorts", next.shorts).apply()
    }

    fun setMuted(next: Boolean) {
        muted = next
        storage.edit().putBoolean("muted", next).apply()
    }

    fun setNsfw(next: Boolean) {
        nsfw = next
        storage.edit().putBoolean("nsfw", next).apply()
    }

    fun seenIds(): Set<String> {
        val saved = storage.getString("seen_" + nsfw, "[]") ?: "[]"
        val result = mutableSetOf<String>()
        runCatching {
            val array = JSONArray(saved)
            for (index in 0 until array.length()) result.add(array.getString(index))
        }
        return result
    }

    fun recordViewed(id: String) {
        val old = seenIds().toMutableList()
        if (!old.contains(id)) old.add(id)
        val capped = old.takeLast(2500)
        storage.edit().putString("seen_" + nsfw, JSONArray(capped).toString()).apply()
    }

    fun clearHistory() {
        storage.edit().remove("seen_" + nsfw).apply()
    }

    /**
     * Bookmarks are local to the device and to the selected content pool.
     * Store sufficient content to reopen saved reading even when offline.
     */
    fun savedItems(): List<FeedItem> = runCatching {
        val saved = JSONArray(storage.getString("bookmarks_" + nsfw, "[]") ?: "[]")
        (0 until saved.length()).mapNotNull { index ->
            saved.optJSONObject(index)?.toItem()
        }.filter { it.id.isNotBlank() && it.isNsfw == nsfw }
    }.getOrDefault(emptyList())

    fun toggleSaved(item: FeedItem): List<FeedItem> {
        require(item.isNsfw == nsfw) { "Cannot save content from another pool" }
        val updated = savedItems().toMutableList()
        val current = updated.indexOfFirst { it.id == item.id }
        if (current >= 0) updated.removeAt(current) else updated.add(0, item)
        val retained = updated.take(80)
        val json = JSONArray()
        retained.forEach { saved -> json.put(saved.toBookmarkJson()) }
        storage.edit().putString("bookmarks_" + nsfw, json.toString()).apply()
        return retained
    }

    private fun FeedItem.toBookmarkJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("kind", kind)
        put("title", title)
        put("author", author)
        put("permalink", permalink)
        put("bucket", bucket)
        put("media_url", mediaUrl)
        put("media_kind", mediaKind)
        put("poster_url", posterUrl)
        put("excerpt", excerpt)
        put("published_at", publishedAt)
        put("ingested_at", ingestedAt)
        put("quality_score", quality)
        put("visual_score", visual)
        put("engagement_score", engagement)
        put("is_nsfw", isNsfw)
        val blocks = JSONArray()
        body.take(24).forEach { paragraph ->
            blocks.put(JSONObject().put("t", "p").put("text", paragraph.take(1600)))
        }
        put("body", blocks)
    }

    suspend fun fetch(kind: String, offset: Int, limit: Int = 45): FeedBatch =
        withContext(Dispatchers.IO) {
            val cutoff = Instant.now().minus(30, ChronoUnit.DAYS)
            // NSFW videos use a server-side round-robin page across actual publishers.
            // A straight published_at query filled every page with RedGIFs before other
            // providers could be fetched, even when those providers had fresh clips.
            val mixedAdultVideos = nsfw && kind == "video"
            val mixedSafe = !nsfw
            val path = when {
                mixedAdultVideos -> "/rest/v1/rpc/get_mixed_nsfw_video_page"
                mixedSafe -> "/rest/v1/rpc/get_mixed_safe_feed_page"
                else -> "/rest/v1/items"
            }
            val endpoint = Uri.parse(BuildConfig.SUPABASE_URL + path)
                .buildUpon()
                .appendQueryParameter(
                    "select",
                    "id,kind,title,author,permalink,published_at,ingested_at,bucket,is_nsfw," +
                    "media_url,media_kind,poster_url,excerpt,body,quality_score,visual_score,engagement_score"
                )
                .apply {
                    if (mixedSafe || mixedAdultVideos) {
                        if (mixedSafe) appendQueryParameter("p_kind", kind)
                        appendQueryParameter("p_limit", limit.toString())
                        appendQueryParameter("p_offset", offset.toString())
                    } else {
                        appendQueryParameter("is_nsfw", "eq." + nsfw)
                        appendQueryParameter("kind", "eq." + kind)
                        appendQueryParameter("published_at", "gte." + cutoff.toString())
                        appendQueryParameter("order", "published_at.desc")
                        appendQueryParameter("limit", limit.toString())
                        appendQueryParameter("offset", offset.toString())
                    }
                }
                .build()
            val cacheKey = "cache_published_v5_" + nsfw + "_" + kind
            var fetchedOnline = false
            val body = try {
                val conn = URL(endpoint.toString()).openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "GET"
                    conn.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
                    conn.setRequestProperty("Accept", "application/json")
                    conn.connectTimeout = 12000
                    conn.readTimeout = 12000
                    val status = conn.responseCode
                    if (status !in 200..299) {
                        val info = conn.errorStream?.bufferedReader()?.use { it.readText().take(240) } ?: ""
                        throw IOException("Feed server returned HTTP " + status + ": " + info)
                    }
                    fetchedOnline = true
                    conn.inputStream.bufferedReader().use { it.readText() }
                } finally {
                    conn.disconnect()
                }
            } catch (error: Exception) {
                Log.w("MixdownFeed", "Feed fetch failed for kind=" + kind +
                    " (offset=" + offset + "): " + error.javaClass.simpleName +
                    ": " + (error.message ?: "no details"))
                if (offset > 0) throw error
                storage.getString(cacheKey, null) ?: throw error
            }
            val parsed = JSONArray(body)
            if (fetchedOnline && offset == 0) {
                storage.edit().putString(cacheKey, body).apply()
            }
            val items = (0 until parsed.length()).mapNotNull { index ->
                parsed.optJSONObject(index)?.toItem()
            }.filter { item ->
                item.isNsfw == nsfw &&
                    (kind != "video" || item.playable) &&
                    runCatching {
                        val published = Instant.parse(item.publishedAt)
                        !published.isBefore(cutoff) &&
                            !published.isAfter(Instant.now().plus(1, ChronoUnit.DAYS))
                    }.getOrDefault(false)
            }
            // Advance by rows returned from PostgREST, not items that survived local validation.
            // Otherwise a filtered media item causes the same backend page to be requested again.
            FeedBatch(items, parsed.length())
        }

    private fun JSONObject.toItem(): FeedItem {
        val blocks = optJSONArray("body")
        val paragraphs = if (blocks == null) emptyList() else (0 until blocks.length()).mapNotNull { n ->
            val block = blocks.optJSONObject(n) ?: return@mapNotNull null
            when (block.optString("t")) {
                "p", "h", "quote", "li", "code" -> FeedText.plain(block.optString("text")).takeIf { it.isNotBlank() }
                else -> null
            }
        }
        return FeedItem(
            id = optString("id"),
            kind = optString("kind"),
            title = FeedText.plain(optString("title")),
            author = FeedText.plain(optString("author")),
            permalink = optString("permalink"),
            bucket = optString("bucket"),
            mediaUrl = optString("media_url"),
            mediaKind = optString("media_kind"),
            posterUrl = optString("poster_url").replace("&#038;", "&"),
            excerpt = FeedText.plain(optString("excerpt")),
            body = paragraphs,
            publishedAt = optString("published_at"),
            ingestedAt = optString("ingested_at"),
            quality = optDouble("quality_score", 0.0).let { if (it.isFinite()) it else 0.0 },
            visual = optDouble("visual_score", 0.0).let { if (it.isFinite()) it else 0.0 },
            engagement = optDouble("engagement_score", 0.0).let { if (it.isFinite()) it else 0.0 },
            isNsfw = optBoolean("is_nsfw", false)
        )
    }
}
