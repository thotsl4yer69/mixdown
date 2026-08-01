package expo.modules.media3feed

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource

/**
 * Fixed-size pool of warm [ExoPlayer] decoders for the feed.
 *
 * The one idea this class exists to serve: exactly one [Surface] is ever attached to a player at
 * a time (the settled item's), but 3-4 *other* players sit prepared with buffered media and no
 * surface, ready for their surface to be attached the instant the user settles on them. That's
 * what makes swiping feel instant instead of paying decoder-init + first-frame cost on every
 * settle.
 *
 * Not thread-safe beyond "always call from the main thread" — Expo Modules already dispatches
 * async function bodies onto the main thread for view-owning modules, and all playback callbacks
 * from ExoPlayer land on the main looper by construction.
 */
@UnstableApi
class PreloadController(private val context: Context) {

    interface Listener {
        fun onFirstFrame(itemId: String)
        fun onBuffering(itemId: String, isBuffering: Boolean)
        fun onPlaybackError(itemId: String, message: String)
        fun onCompleted(itemId: String)
    }

    data class QueueItem(val id: String, val uri: String, val isHls: Boolean)

    private class Slot(val player: ExoPlayer) {
        var itemId: String? = null
        var hasSurface: Boolean = false
    }

    companion object {
        const val DEFAULT_SLOT_BUDGET = 3
        const val MIN_SLOT_BUDGET = 1
        const val MAX_SLOT_BUDGET = 6
    }

    var listener: Listener? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val httpDataSourceFactory = DefaultHttpDataSource.Factory()
    private val cacheDataSourceFactory: CacheDataSource.Factory by lazy {
        CacheDataSource.Factory()
            .setCache(MediaCache.get(context))
            .setUpstreamDataSourceFactory(DefaultDataSource.Factory(context, httpDataSourceFactory))
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    }

    private var queue: List<QueueItem> = emptyList()
    private var currentIndex: Int = 0
    private var slotBudget: Int = DEFAULT_SLOT_BUDGET
    private val pool = mutableListOf<Slot>()
    private var activeItemId: String? = null
    private var pendingSurface: Surface? = null
    private var suspended = false

    fun decoderBudget(): Int = slotBudget

    /** Replace the working set of video items and re-prepare the pool around [currentIndex]. */
    fun setQueue(items: List<QueueItem>, currentIndex: Int, slotHint: Int) {
        queue = items
        this.currentIndex = if (items.isEmpty()) 0 else currentIndex.coerceIn(0, items.size - 1)
        slotBudget = slotHint.coerceIn(MIN_SLOT_BUDGET, MAX_SLOT_BUDGET)
        if (suspended) return
        ensurePoolSize()
        reconcile()
    }

    /**
     * Make [itemId] the active (visible, playing) item. Detaches the pending surface from
     * whichever slot held it before, attaches it to [itemId]'s slot, and starts playback there.
     * Every other slot in the pool is paused (but stays prepared/buffered).
     */
    fun settle(itemId: String) {
        activeItemId = itemId
        val idx = queue.indexOfFirst { it.id == itemId }
        if (idx >= 0) currentIndex = idx
        reconcile()

        val slot = pool.firstOrNull { it.itemId == itemId } ?: return
        moveSurfaceTo(slot)
        slot.player.playWhenReady = true

        for (other in pool) {
            if (other !== slot) other.player.playWhenReady = false
        }
    }

    fun pauseActive() {
        activeSlot()?.player?.playWhenReady = false
    }

    fun resumeActive() {
        if (!suspended) {
            activeSlot()?.player?.playWhenReady = true
            return
        }
        suspended = false
        ensurePoolSize()
        reconcile()
        activeSlot()?.player?.playWhenReady = true
    }

    fun seekActiveTo(positionMs: Long) {
        activeSlot()?.player?.seekTo(positionMs)
    }

    fun activeProgress(): Pair<Long, Long> {
        val player = activeSlot()?.player ?: return Pair(0L, 0L)
        val duration = player.duration
        return Pair(player.currentPosition, if (duration == C.TIME_UNSET) 0L else duration)
    }

    /** Pause every player and drop the attached surface without tearing the pool down. */
    fun suspendAll() {
        suspended = true
        detachSurface()
        // Releasing the players, rather than merely pausing them, gives the OS back
        // hardware decoder resources while the app is backgrounded.
        for (slot in pool) slot.player.release()
        pool.clear()
    }

    /** Called when the native view's surface is (re)created; reattaches to the active slot. */
    fun attachSurface(surface: Surface) {
        if (suspended) return
        pendingSurface = surface
        activeSlot()?.let { moveSurfaceTo(it) }
    }

    /** Called when the native view's surface is destroyed (view unmounted, app backgrounded). */
    fun detachSurface() {
        pendingSurface = null
        for (slot in pool) {
            if (slot.hasSurface) {
                slot.player.clearVideoSurface()
                slot.hasSurface = false
            }
        }
    }

    fun release() {
        suspended = false
        detachSurface()
        for (slot in pool) slot.player.release()
        pool.clear()
        queue = emptyList()
        activeItemId = null
    }

    // ---- internals ---------------------------------------------------------------------------

    private fun activeSlot(): Slot? {
        val id = activeItemId ?: return null
        return pool.firstOrNull { it.itemId == id }
    }

    private fun moveSurfaceTo(slot: Slot) {
        val surface = pendingSurface ?: return
        for (other in pool) {
            if (other !== slot && other.hasSurface) {
                other.player.clearVideoSurface()
                other.hasSurface = false
            }
        }
        slot.player.setVideoSurface(surface)
        slot.hasSurface = true
    }

    private fun ensurePoolSize() {
        while (pool.size < slotBudget) pool.add(buildSlot())
        while (pool.size > slotBudget) {
            val slot = pool.removeAt(pool.size - 1)
            slot.player.release()
        }
    }

    private fun buildSlot(): Slot {
        val renderersFactory = DefaultRenderersFactory(context)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
        val player = ExoPlayer.Builder(context, renderersFactory).build()
        val slot = Slot(player)
        player.addListener(SlotListener(slot))
        return slot
    }

    /**
     * Assign the window of items around [currentIndex] (radius = [slotBudget]) to pool slots,
     * reusing a slot that already holds the right item, and otherwise handing the
     * farthest-from-current occupied slot to the nearest unassigned item that needs one.
     */
    private fun reconcile() {
        if (queue.isEmpty() || pool.isEmpty()) return

        val windowIndices = windowAround(currentIndex, slotBudget, queue.size)
        val windowItems = windowIndices.map { queue[it] }

        // Slots already holding an item that's still in the window: keep them.
        val keep = pool.filter { slot -> windowItems.any { it.id == slot.itemId } }
        val free = pool.filter { it !in keep }.toMutableList()
        val needing = windowItems.filter { item -> keep.none { it.itemId == item.id } }

        for (item in needing) {
            val slot = free.removeFirstOrNull() ?: continue
            prepare(slot, item)
        }
    }

    private fun prepare(slot: Slot, item: QueueItem) {
        if (slot.hasSurface) {
            slot.player.clearVideoSurface()
            slot.hasSurface = false
        }
        slot.itemId = item.id
        val mediaItem = MediaItem.Builder().setUri(item.uri).setMediaId(item.id).build()
        val source = buildMediaSource(item, mediaItem)
        slot.player.setMediaSource(source)
        slot.player.prepare()
        slot.player.playWhenReady = false
    }

    private fun buildMediaSource(item: QueueItem, mediaItem: MediaItem): MediaSource {
        return if (item.isHls) {
            HlsMediaSource.Factory(cacheDataSourceFactory).createMediaSource(mediaItem)
        } else {
            ProgressiveMediaSource.Factory(cacheDataSourceFactory).createMediaSource(mediaItem)
        }
    }

    private fun windowAround(center: Int, radius: Int, size: Int): List<Int> {
        if (size == 0) return emptyList()
        val before = radius / 2
        val start = (center - before).coerceAtLeast(0)
        val end = (start + radius - 1).coerceAtMost(size - 1)
        val adjustedStart = (end - radius + 1).coerceAtLeast(0)
        return (adjustedStart..end).toList()
    }

    private inner class SlotListener(private val slot: Slot) : Player.Listener {
        override fun onRenderedFirstFrame() {
            val id = slot.itemId ?: return
            if (slot === activeSlot()) {
                mainHandler.post { listener?.onFirstFrame(id) }
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            val id = slot.itemId ?: return
            if (slot !== activeSlot()) return
            when (playbackState) {
                Player.STATE_BUFFERING -> listener?.onBuffering(id, true)
                Player.STATE_READY -> listener?.onBuffering(id, false)
                Player.STATE_ENDED -> listener?.onCompleted(id)
                else -> {}
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            val id = slot.itemId ?: return
            listener?.onPlaybackError(id, error.message ?: "playback error")
        }
    }
}
