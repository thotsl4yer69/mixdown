package au.com.mazlabz.mixdown

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

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

    suspend fun fetch(kind: String, offset: Int, limit: Int = 45): List<FeedItem> =
        withContext(Dispatchers.IO) {
            val endpoint = Uri.parse(BuildConfig.SUPABASE_URL + "/rest/v1/items")
                .buildUpon()
                .appendQueryParameter(
                    "select",
                    "id,kind,title,author,permalink,published_at,ingested_at,bucket,is_nsfw," +
                    "media_url,media_kind,poster_url,excerpt,body,quality_score,visual_score,engagement_score"
                )
                .appendQueryParameter("is_nsfw", "eq." + nsfw)
                .appendQueryParameter("kind", "eq." + kind)
                .appendQueryParameter("order", "ingested_at.desc")
                .appendQueryParameter("limit", limit.toString())
                .appendQueryParameter("offset", offset.toString())
                .build()
            val cacheKey = "cache_" + nsfw + "_" + kind
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
                if (offset > 0) throw error
                storage.getString(cacheKey, null) ?: throw error
            }
            val parsed = JSONArray(body)
            if (fetchedOnline && offset == 0) {
                storage.edit().putString(cacheKey, body).apply()
            }
            (0 until parsed.length()).mapNotNull { index ->
                parsed.optJSONObject(index)?.toItem()
            }.filter { it.isNsfw == nsfw }
        }

    private fun JSONObject.toItem(): FeedItem {
        val blocks = optJSONArray("body")
        val paragraphs = if (blocks == null) emptyList() else (0 until blocks.length()).mapNotNull { n ->
            val block = blocks.optJSONObject(n) ?: return@mapNotNull null
            when (block.optString("t")) {
                "p", "h", "quote", "li", "code" -> block.optString("text").takeIf { it.isNotBlank() }
                else -> null
            }
        }
        return FeedItem(
            id = optString("id"),
            kind = optString("kind"),
            title = optString("title"),
            author = optString("author"),
            permalink = optString("permalink"),
            bucket = optString("bucket"),
            mediaUrl = optString("media_url"),
            mediaKind = optString("media_kind"),
            posterUrl = optString("poster_url").replace("&#038;", "&"),
            excerpt = optString("excerpt"),
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
