package expo.modules.media3feed

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

/**
 * Process-wide singleton disk cache for feed media. Media3's [SimpleCache] must have exactly
 * one live instance per cache directory for the life of the process, so this is a plain
 * lazily-initialized singleton rather than something owned by [PreloadController] — the
 * controller (and the players it prepares) can be recreated freely without ever touching this.
 */
@UnstableApi
object MediaCache {
    private const val CACHE_DIR_NAME = "media3_feed_cache"
    private const val MAX_CACHE_BYTES = 300L * 1024 * 1024 // 300MB — enough for a healthy prefetch window

    @Volatile
    private var instance: SimpleCache? = null

    fun get(context: Context): SimpleCache {
        return instance ?: synchronized(this) {
            instance ?: buildCache(context.applicationContext).also { instance = it }
        }
    }

    private fun buildCache(context: Context): SimpleCache {
        val dir = File(context.cacheDir, CACHE_DIR_NAME)
        dir.mkdirs()
        val evictor = LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES)
        val databaseProvider = StandaloneDatabaseProvider(context)
        return SimpleCache(dir, evictor, databaseProvider)
    }
}
