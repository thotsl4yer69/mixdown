package au.com.mazlabz.mixdown

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.VideoSize
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val Ink = Color(0xFF080A0E)
private val Panel = Color(0xFF151922)
private val TextBright = Color(0xFFF6F5F1)
private val TextDim = Color(0xFFB2B6C2)
private val Accent = Color(0xFFFF6E4B)
private val Mint = Color(0xFF9AFFCD)
private val Border = Color(0xFF343945)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                primary = Accent, secondary = Mint, background = Ink,
                surface = Panel, onSurface = TextBright, onBackground = TextBright
            )) {
                val context = LocalContext.current
                val store = remember { MixdownStore(FeedRepository(context.applicationContext)) }
                MixdownScreen(store)
            }
        }
    }
}

private class MixdownStore(private val repo: FeedRepository) {
    val items: SnapshotStateList<FeedItem> = mutableStateListOf()
    private val all = mutableListOf<FeedItem>()
    private val offsets = mutableMapOf("video" to 0, "article" to 0)

    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf("")
        private set
    var filter by mutableStateOf(FeedFilter.ALL)
        private set
    var taste by mutableStateOf(repo.taste)
        private set
    var muted by mutableStateOf(repo.muted)
        private set
    var nsfw by mutableStateOf(repo.nsfw)
        private set
    var exhausted by mutableStateOf(false)
        private set
    var saved by mutableStateOf(repo.savedItems())
        private set

    suspend fun reload() = load(reset = true)
    suspend fun more() = load(reset = false)

    private suspend fun load(reset: Boolean) {
        if (loading || (!reset && exhausted)) return
        loading = true
        error = ""
        try {
            // Retain the visible feed until new content is ready. A transient
            // network failure should never blank the user's scrolling session.
            if (reset) {
                exhausted = false
            }
            val batches = coroutineScope {
                listOf("video", "article").map { kind ->
                    async {
                        val batch = runCatching { repo.fetch(kind, if (reset) 0 else (offsets[kind] ?: 0)) }
                        kind to batch
                    }
                }.awaitAll()
            }
            var errors = 0
            var rawReceived = 0
            val added = ArrayList<FeedItem>()
            for ((kind, result) in batches) {
                result.onSuccess { chunk ->
                    // Reset uses the first page of each pool. Pagination advances
                    // only for pools whose requests actually succeeded.
                    val start = if (reset) 0 else offsets[kind] ?: 0
                    offsets[kind] = chunk.nextOffset(start)
                    rawReceived += chunk.received
                    added.addAll(chunk.items)
                }.onFailure { errors++ }
            }
            val seen = repo.seenIds()
            val existing = if (reset) emptySet() else all.mapTo(HashSet()) { it.id }
            val newItems = added.filter { it.id !in existing && it.id !in seen }
                .distinctBy { it.id }
            if (reset) {
                if (errors < batches.size && newItems.isNotEmpty()) {
                    // Only switch the visible list after a usable replacement
                    // arrives. Avoid blanking the screen for seen-only or failed refreshes.
                    all.clear()
                    all.addAll(newItems)
                    items.clear()
                    items.addAll(FeedRanker.rank(all, taste, filter))
                } else if (items.isNotEmpty()) {
                    error = if (errors == batches.size) {
                        "Couldn't refresh. Your previous mix is still available."
                    } else {
                        "No unseen posts in the latest batch. Keeping your mix."
                    }
                }
            } else {
                all.addAll(newItems)
                val ranked = FeedRanker.rank(newItems, taste, filter)
                val displayed = items.mapTo(HashSet()) { it.id }
                items.addAll(ranked.filter { it.id !in displayed })
            }
            // Only a genuinely empty server response exhausts pagination. Client-side
            // freshness, safety and media validation may filter an otherwise full page.
            if (rawReceived == 0 && errors == 0) exhausted = true
            if (items.isEmpty()) {
                error = if (errors == batches.size) {
                    "Could not reach the feed. Check your connection and try again."
                } else if (seen.isNotEmpty()) {
                    "You've caught up with the current batch. Reset viewed history or refresh for new posts."
                } else {
                    "No content in this feed yet. Try a different category."
                }
            } else if (errors > 0) {
                // Keep readable content on screen when one third-party source fails.
                error = "Some feed categories could not update. Available content is shown."
            }
        } catch (failure: Exception) {
            error = failure.message ?: "The feed couldn't load."
        } finally {
            loading = false
        }
    }

    fun select(next: FeedFilter) {
        if (filter == next) return
        filter = next
        items.clear()
        items.addAll(FeedRanker.rank(all, taste, filter))
    }

    fun updateTaste(next: Taste) {
        taste = next
        repo.saveTaste(next)
        val reordered = FeedRanker.rank(all, taste, filter)
        items.clear()
        items.addAll(reordered)
    }

    fun updateMuted(next: Boolean) {
        muted = next
        repo.setMuted(next)
    }

    fun updateNsfw(next: Boolean) {
        nsfw = next
        repo.setNsfw(next)
        saved = repo.savedItems()
        all.clear()
        items.clear()
        offsets.keys.forEach { offsets[it] = 0 }
        exhausted = false
    }

    fun markViewed(id: String) = repo.recordViewed(id)

    fun toggleSaved(item: FeedItem) {
        saved = repo.toggleSaved(item)
    }

    fun resetHistory() {
        repo.clearHistory()
        exhausted = false
    }
}

@Composable
private fun MixdownScreen(store: MixdownStore) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current
    val pagerState = rememberPagerState(pageCount = { store.items.size })
    val player = remember(context) { ExoPlayer.Builder(context).build().apply { repeatMode = Player.REPEAT_MODE_ONE } }
    var settingsOpen by remember { mutableStateOf(false) }
    var savedOpen by remember { mutableStateOf(false) }
    var reader by remember { mutableStateOf<FeedItem?>(null) }
    var playbackError by remember { mutableStateOf("") }
    var videoAspect by remember { mutableFloatStateOf(1f) }
    val active = store.items.getOrNull(pagerState.settledPage)

    LaunchedEffect(Unit) { store.reload() }

    LaunchedEffect(store.nsfw) {
        if (store.items.isEmpty() && !store.loading) store.reload()
    }

    LaunchedEffect(store.filter) {
        if (pagerState.currentPage != 0) pagerState.scrollToPage(0)
    }

    LaunchedEffect(pagerState.settledPage, active?.id) {
        active?.let { store.markViewed(it.id) }
        if (pagerState.settledPage >= store.items.size - 7 && store.items.size > 0) {
            store.more()
        }
    }

    LaunchedEffect(store.muted) {
        // Muting never re-prepares the current video or loses playback position.
        player.volume = if (store.muted) 0f else 1f
    }

    LaunchedEffect(active?.id) {
        player.pause()
        player.clearMediaItems()
        playbackError = ""
        videoAspect = 1f
        if (active?.playable == true) {
            val media = MediaItem.Builder().setUri(active.mediaUrl)
                .apply {
                    if (active.mediaKind == "hls") setMimeType(MimeTypes.APPLICATION_M3U8)
                }.build()
            player.setMediaItem(media)
            player.prepare()
            player.playWhenReady = true
        }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                playbackError = "This clip couldn't play. Open the original to view it."
            }
            override fun onVideoSizeChanged(videoSize: VideoSize) {
                val width = videoSize.width
                val height = videoSize.height
                if (width > 0 && height > 0) {
                    videoAspect = (width * videoSize.pixelWidthHeightRatio / height)
                        .coerceIn(0.35f, 3.0f)
                }
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }

    DisposableEffect(lifecycleOwner, player) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> player.pause()
                Lifecycle.Event.ON_START -> {
                    if (player.mediaItemCount > 0 && reader == null && !settingsOpen && !savedOpen) player.play()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(reader, settingsOpen, savedOpen) {
        if (reader != null || settingsOpen || savedOpen) player.pause()
        else if (active?.playable == true) player.play()
    }

    Box(Modifier.fillMaxSize().background(Ink)) {
        if (store.items.isNotEmpty()) {
            VerticalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize(),
                beyondViewportPageCount = 1,
                key = { index -> store.items[index].id }
            ) { index ->
                val item = store.items[index]
                if (item.kind == "article") {
                    HeadlinePage(
                        item = item,
                        saved = store.saved.any { it.id == item.id },
                        onRead = { reader = item },
                        onOriginal = { openSource(context, item.permalink) },
                        onShare = { shareSource(context, item) },
                        onSave = { store.toggleSaved(item) }
                    )
                } else FeedPage(
                    item = item,
                    player = player,
                    active = index == pagerState.settledPage,
                    videoAspect = videoAspect,
                    playbackError = if (index == pagerState.settledPage) playbackError else "",
                    onRead = { reader = item },
                    onOriginal = { openSource(context, item.permalink) },
                    onShare = { shareSource(context, item) },
                    onSave = { store.toggleSaved(item) },
                    saved = store.saved.any { it.id == item.id },
                    onMute = { store.updateMuted(!store.muted) },
                    muted = store.muted
                )
            }
        } else {
            Column(
                modifier = Modifier.fillMaxSize().padding(horizontal = 28.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (store.loading) {
                    CircularProgressIndicator(color = Accent)
                    Spacer(Modifier.height(20.dp))
                    Text("Finding your next rabbit hole", color = TextBright, fontSize = 19.sp)
                } else {
                    Text("Nothing to scroll yet", fontSize = 25.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(12.dp))
                    Text(store.error, color = TextDim, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(18.dp))
                    Button(onClick = { scope.launch { store.reload() } }) { Text("TRY AGAIN") }
                }
            }
        }

        Column(
            Modifier.fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color(0xE6080A0E), Color.Transparent)))
                .statusBarsPadding()
                .padding(horizontal = 18.dp, vertical = 14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("MIX", fontSize = 25.sp, color = TextBright, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
                Text("DOWN", fontSize = 25.sp, color = Accent, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
                Spacer(Modifier.weight(1f))
                Box(Modifier.size(8.dp).background(Mint, CircleShape))
                Spacer(Modifier.width(8.dp))
                Text("DISCOVER", fontSize = 10.sp, color = Mint, letterSpacing = 1.sp)
                Spacer(Modifier.width(14.dp))
                Text("★", modifier = Modifier.semantics { contentDescription = "Open saved library" }
                    .clickable { savedOpen = true }.padding(8.dp),
                    fontSize = 23.sp, color = Mint)
                Text("↻", modifier = Modifier.semantics { contentDescription = "Refresh feed" }
                    .clickable { scope.launch { store.reload() } }.padding(8.dp),
                    fontSize = 28.sp, color = TextBright)
                Text("⚙", modifier = Modifier.semantics { contentDescription = "Open settings" }
                    .clickable { settingsOpen = true }.padding(8.dp),
                    fontSize = 25.sp, color = TextBright)
            }
            if (store.error.isNotBlank() && store.items.isNotEmpty()) {
                Text(store.error, color = TextDim, fontSize = 11.sp, maxLines = 2)
            }
        }

        Row(
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xF6080A0E), Ink)))
                .navigationBarsPadding().padding(start = 14.dp, end = 14.dp, bottom = 18.dp, top = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FeedFilter.entries.forEach { option ->
                val selected = store.filter == option
                Box(
                    modifier = Modifier.weight(1f)
                        .clip(RoundedCornerShape(24.dp))
                        .background(if (selected) Accent else Panel)
                        .clickable { store.select(option) }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(option.title, fontSize = 12.sp,
                        color = if (selected) Ink else TextDim,
                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
                }
            }
        }
    }

    if (savedOpen) {
        SavedDialog(
            saved = store.saved,
            onDismiss = { savedOpen = false },
            onOpen = { item ->
                savedOpen = false
                if (item.kind == "video") openSource(context, item.permalink)
                else reader = item
            },
            onRemove = { store.toggleSaved(it) }
        )
    }
    if (settingsOpen) {
        SettingsDialog(
            store = store,
            onDismiss = { settingsOpen = false },
            onReset = {
                store.resetHistory()
                settingsOpen = false
                scope.launch { store.reload() }
            },
            onPoolChange = { changed ->
                store.updateNsfw(changed)
                settingsOpen = false
                scope.launch { store.reload() }
            }
        )
    }
    reader?.let { item ->
        ReaderDialog(item, onDismiss = { reader = null }, onOriginal = { openSource(context, item.permalink) })
    }
}

@Composable
private fun FeedPage(
    item: FeedItem,
    player: ExoPlayer,
    active: Boolean,
    videoAspect: Float,
    playbackError: String,
    onRead: () -> Unit,
    onOriginal: () -> Unit,
    onShare: () -> Unit,
    onSave: () -> Unit,
    saved: Boolean,
    onMute: () -> Unit,
    muted: Boolean
) {
    Box(Modifier.fillMaxSize().background(Ink)) {
        // Image underlay makes wide clips feel intentional instead of leaving
        // a giant empty black stage above and below the player.
        if (item.posterUrl.startsWith("https://")) {
            AsyncImage(
                model = item.posterUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            Box(Modifier.fillMaxSize().background(Color(0x99080A0E)))
        } else {
            Box(Modifier.fillMaxSize().background(
                Brush.linearGradient(listOf(Color(0xFF252C36), Ink))
            ))
        }

        if (item.playable && active) {
            val landscape = videoAspect > 1.15f
            AndroidView(
                factory = { context ->
                    PlayerView(context).apply {
                        this.player = player
                        useController = false
                        resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                        setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                    }
                },
                update = { view ->
                    view.player = player
                    view.resizeMode = if (landscape)
                        androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
                    else
                        androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                },
                modifier = if (landscape)
                    Modifier.fillMaxWidth().aspectRatio(videoAspect).align(Alignment.Center)
                else
                    Modifier.fillMaxSize()
            )
        }

        Box(Modifier.fillMaxSize().background(
            Brush.verticalGradient(
                0f to Color(0x55080A0E),
                0.30f to Color.Transparent,
                0.66f to Color(0xBB080A0E),
                1f to Ink
            )
        ))

        Column(
            modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth()
                .padding(start = 22.dp, end = 76.dp, bottom = 118.dp)
        ) {
            val marker = when (item.kind) {
                "video" -> "WATCH / " + item.bucket.uppercase().replace("-", " ")
                else -> "STORY / " + item.bucket.uppercase().replace("-", " ")
            }
            Text(marker, fontSize = 11.sp, color = Mint, fontWeight = FontWeight.Bold, letterSpacing = 1.1.sp)
            Spacer(Modifier.height(13.dp))
            Text(
                item.title.ifBlank { "Untitled from source" },
                fontSize = if (item.kind == "article") 29.sp else 25.sp,
                lineHeight = if (item.kind == "article") 34.sp else 30.sp,
                color = TextBright,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 5,
                overflow = TextOverflow.Ellipsis
            )
            if (item.excerpt.isNotBlank() && item.kind != "video") {
                Spacer(Modifier.height(12.dp))
                Text(item.excerpt, fontSize = 14.sp, lineHeight = 20.sp,
                    maxLines = 4, overflow = TextOverflow.Ellipsis, color = TextDim)
            }
            Spacer(Modifier.height(14.dp))
            if (item.author.isNotBlank()) {
                Text(item.author, color = TextDim, fontSize = 12.sp, maxLines = 1)
            }
            Text(publishedLabel(item.publishedAt),
                color = Mint, fontSize = 12.sp, maxLines = 1)
            Spacer(Modifier.height(18.dp))
            if (playbackError.isNotBlank()) {
                Text(playbackError, color = Accent, fontSize = 12.sp)
                Spacer(Modifier.height(8.dp))
            }
            if (item.kind != "video") {
                Button(onClick = onRead, colors = ButtonDefaults.buttonColors(containerColor = Accent)) {
                    Text(if (item.kind == "social") "READ POST  ↗" else "READ STORY  ↗",
                        color = Ink, fontWeight = FontWeight.Bold)
                }
            } else if (playbackError.isNotBlank()) {
                OutlinedButton(onClick = onOriginal) { Text("OPEN ORIGINAL", color = TextBright) }
            }
        }
        Column(
            Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 145.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            if (item.playable) RoundAction(if (muted) "♪̸" else "♫", if (muted) "UNMUTE" else "MUTE", onMute)
            RoundAction(if (saved) "★" else "☆", if (saved) "SAVED" else "SAVE", onSave)
            RoundAction("↗", "SHARE", onShare)
            RoundAction("↗", "SOURCE", onOriginal)
            if (item.kind != "video") RoundAction("≡", "READ", onRead)
        }
    }
}

/**
 * Articles are not videos. Give written stories a readable editorial card
 * with an obvious "Read story" action instead of a video player backdrop.
 */
@Composable
private fun HeadlinePage(
    item: FeedItem,
    saved: Boolean,
    onRead: () -> Unit,
    onOriginal: () -> Unit,
    onShare: () -> Unit,
    onSave: () -> Unit
) {
    Box(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(
                listOf(Ink, Color(0xFF19222C), Color(0xFF13151C), Ink)
            )
        )
    ) {
        Column(
            Modifier.fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(start = 24.dp, end = 24.dp, top = 94.dp, bottom = 86.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("STORY / " + item.bucket.replace("-", " ").uppercase(),
                color = Mint, fontWeight = FontWeight.Bold,
                fontSize = 11.sp, letterSpacing = 1.4.sp)
            if (item.posterUrl.startsWith("https://")) {
                AsyncImage(
                    model = item.posterUrl,
                    contentDescription = item.title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().weight(0.95f)
                        .clip(RoundedCornerShape(18.dp))
                )
            } else {
                Spacer(Modifier.height(12.dp))
            }
            Text(
                item.title.ifBlank { "Untitled story" },
                color = TextBright,
                fontSize = 27.sp,
                lineHeight = 31.sp,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                listOf(item.author, publishedLabel(item.publishedAt))
                    .filter { it.isNotBlank() }.joinToString("  •  "),
                color = Mint, fontSize = 12.sp, maxLines = 2
            )
            if (item.excerpt.isNotBlank()) {
                Text(
                    item.excerpt,
                    color = TextDim, fontSize = 15.sp, lineHeight = 21.sp,
                    maxLines = 4, overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(Modifier.weight(0.35f))
            Button(
                onClick = onRead,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Accent)
            ) {
                Text("READ STORY", color = Ink, fontWeight = FontWeight.Bold)
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(if (saved) "★ SAVED" else "☆ SAVE",
                    modifier = Modifier.semantics { contentDescription = "SAVE" }
                        .clickable { onSave() }.padding(8.dp),
                    color = if (saved) Mint else TextBright, fontSize = 12.sp)
                Text("↗ SHARE",
                    modifier = Modifier.clickable { onShare() }.padding(8.dp),
                    color = TextBright, fontSize = 12.sp)
                Text("SOURCE ↗",
                    modifier = Modifier.clickable { onOriginal() }.padding(8.dp),
                    color = TextBright, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun RoundAction(symbol: String, label: String, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.semantics { contentDescription = label }
            .clickable(onClick = onClick)
    ) {
        Box(Modifier.size(46.dp).clip(CircleShape).background(Color(0xCC252A32)),
            contentAlignment = Alignment.Center) {
            Text(symbol, fontSize = 25.sp, color = TextBright)
        }
        Text(label, color = TextBright, fontSize = 9.sp, letterSpacing = 0.5.sp)
    }
}

@Composable
private fun SettingsDialog(
    store: MixdownStore,
    onDismiss: () -> Unit,
    onReset: () -> Unit,
    onPoolChange: (Boolean) -> Unit
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxSize().background(Ink).statusBarsPadding().navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 25.dp, vertical = 24.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("TUNE YOUR MIX", fontSize = 25.sp, fontWeight = FontWeight.Black, color = TextBright)
                Spacer(Modifier.weight(1f))
                Text("✕", Modifier.clickable(onClick = onDismiss).padding(8.dp), color = TextBright, fontSize = 22.sp)
            }
            Spacer(Modifier.height(12.dp))
            Text("Your feed learns what you enjoy. Adjust these any time; the mix changes immediately.",
                color = TextDim, lineHeight = 22.sp)
            Spacer(Modifier.height(32.dp))
            TasteSlider("TECH & LEARNING", store.taste.tech) {
                store.updateTaste(store.taste.copy(tech = it))
            }
            TasteSlider("ENTERTAINMENT & FUN", store.taste.entertainment) {
                store.updateTaste(store.taste.copy(entertainment = it))
            }
            TasteSlider("COMEDY & ZINES", store.taste.comedy) {
                store.updateTaste(store.taste.copy(comedy = it))
            }
            TasteSlider("SHORTS & REELS", store.taste.shorts) {
                store.updateTaste(store.taste.copy(shorts = it))
            }
            Spacer(Modifier.height(10.dp))
            HorizontalDivider(color = Border)
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Start clips muted", color = TextBright, fontWeight = FontWeight.Bold)
                    Text("Tap the music icon to hear a clip", color = TextDim, fontSize = 12.sp)
                }
                Switch(checked = store.muted, onCheckedChange = store::updateMuted)
            }
            Spacer(Modifier.height(24.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Separate adult-content feed", color = TextBright, fontWeight = FontWeight.Bold)
                    Text("Off by default. Adult and general feeds never mix.", color = TextDim, fontSize = 12.sp)
                }
                Switch(checked = store.nsfw, onCheckedChange = onPoolChange)
            }
            Spacer(Modifier.height(32.dp))
            OutlinedButton(onClick = onReset, modifier = Modifier.fillMaxWidth()) {
                Text("RESET VIEWED HISTORY", color = TextBright)
            }
            Spacer(Modifier.height(18.dp))
            Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Accent)) {
                Text("BACK TO THE FEED", color = Ink, fontWeight = FontWeight.Bold)
            }
        }
    }
}


@Composable
private fun SavedDialog(
    saved: List<FeedItem>,
    onDismiss: () -> Unit,
    onOpen: (FeedItem) -> Unit,
    onRemove: (FeedItem) -> Unit
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxSize().background(Ink).statusBarsPadding().navigationBarsPadding()
                .padding(horizontal = 22.dp, vertical = 18.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("SAVED / MIXDOWN", color = TextBright, fontSize = 22.sp,
                    fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                Text("✕", modifier = Modifier.semantics { contentDescription = "Close saved library" }
                    .clickable { onDismiss() }.padding(10.dp),
                    color = TextBright, fontSize = 22.sp)
            }
            Text("Your library stays on this phone, including offline reading.",
                color = TextDim, fontSize = 12.sp)
            Spacer(Modifier.height(18.dp))
            if (saved.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Nothing saved yet. Tap ☆ on any post to keep it here.",
                        color = TextDim, textAlign = TextAlign.Center)
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(saved, key = { it.id }) { item ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(15.dp))
                                .background(Panel).padding(15.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(
                                Modifier.weight(1f).clickable { onOpen(item) },
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(item.kind.uppercase(), fontSize = 10.sp,
                                    color = Mint, fontWeight = FontWeight.Bold)
                                Text(item.title, color = TextBright, maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                Text(item.author.ifBlank { "OPEN ITEM →" }, color = TextDim,
                                    maxLines = 1, fontSize = 11.sp)
                            }
                            Spacer(Modifier.width(8.dp))
                            Text("✕", modifier = Modifier.semantics { contentDescription = "Remove saved item" }
                                .clickable { onRemove(item) }.padding(9.dp), fontSize = 20.sp, color = Accent)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TasteSlider(name: String, value: Float, onChange: (Float) -> Unit) {
    Row {
        Text(name, color = TextBright, fontSize = 12.sp, fontWeight = FontWeight.Bold,
            letterSpacing = 0.7.sp)
        Spacer(Modifier.weight(1f))
        Text((value * 100).toInt().toString() + "%", color = Mint, fontSize = 12.sp)
    }
    Slider(value = value, onValueChange = onChange, valueRange = 0f..1f)
    Spacer(Modifier.height(18.dp))
}

@Composable
private fun ReaderDialog(item: FeedItem, onDismiss: () -> Unit, onOriginal: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxSize().background(Ink).statusBarsPadding().navigationBarsPadding()
        ) {
            Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("MIXDOWN / READER", fontSize = 12.sp, color = Accent, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                Text("✕", Modifier.clickable(onClick = onDismiss).padding(8.dp), color = TextBright, fontSize = 22.sp)
            }
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
            ) {
                Text(item.bucket.uppercase().replace("-", " "), fontSize = 11.sp, color = Mint)
                Spacer(Modifier.height(14.dp))
                Text(item.title, fontSize = 29.sp, lineHeight = 35.sp, fontWeight = FontWeight.ExtraBold, color = TextBright)
                Spacer(Modifier.height(12.dp))
                Text(listOf(item.author, publishedLabel(item.publishedAt))
                    .filter { it.isNotBlank() }.joinToString("  •  "), color = TextDim)
                Spacer(Modifier.height(20.dp))
                if (item.posterUrl.startsWith("https://")) {
                    AsyncImage(model = item.posterUrl, contentDescription = item.title,
                        contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(240.dp)
                            .clip(RoundedCornerShape(16.dp)))
                    Spacer(Modifier.height(24.dp))
                }
                val paragraphs = item.body.ifEmpty { listOf(item.excerpt) }.filter { it.isNotBlank() }
                if (paragraphs.isEmpty()) {
                    Text("Continue reading at the original publisher.", color = TextDim, lineHeight = 23.sp)
                }
                paragraphs.forEach { paragraph ->
                    Text(paragraph, color = TextBright, fontSize = 17.sp, lineHeight = 27.sp)
                    Spacer(Modifier.height(18.dp))
                }
                Spacer(Modifier.height(24.dp))
            }
            Button(
                onClick = onOriginal,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent)
            ) { Text("OPEN ORIGINAL SOURCE  ↗", color = Ink, fontWeight = FontWeight.Bold) }
        }
    }
}

private fun publishedLabel(iso: String): String = runCatching {
    "Published " + DateTimeFormatter.ofPattern("d MMM yyyy")
        .withZone(ZoneId.of("Australia/Melbourne"))
        .format(Instant.parse(iso))
}.getOrDefault("Publication date unknown")

private fun shareSource(context: android.content.Context, item: FeedItem) {
    val uri = runCatching { Uri.parse(item.permalink) }.getOrNull() ?: return
    if (uri.scheme != "https" && uri.scheme != "http") return
    val share = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, item.title + "\n" + item.permalink)
    }
    runCatching { context.startActivity(Intent.createChooser(share, "Share from Mixdown")) }
}

private fun openSource(context: android.content.Context, url: String) {
    val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
    if (uri.scheme != "https" && uri.scheme != "http") return
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
