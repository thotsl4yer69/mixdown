package expo.modules.media3feed

import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Mirrors the `FeedItemSpec` shape from `media3-feed/src/index.ts`. */
class FeedItemRecord : Record {
    @Field
    val id: String = ""

    @Field
    val uri: String = ""

    @Field
    val isHls: Boolean = false
}

class ControllerNotReadyException :
    CodedException("Media3Feed native controller isn't initialized yet")

@UnstableApi
class Media3FeedModule : Module() {

    companion object {
        /** Read by [Media3FeedView] to reach the controller that owns the shared decoder pool. */
        var currentController: PreloadController? = null
            private set
    }

    private val controller: PreloadController
        get() = currentController ?: throw ControllerNotReadyException()

    override fun definition() = ModuleDefinition {
        Name("Media3Feed")

        Events("onFirstFrame", "onBuffering", "onPlaybackError", "onCompleted")

        OnCreate {
            val ctx = appContext.reactContext ?: return@OnCreate
            val instance = PreloadController(ctx)
            instance.listener = object : PreloadController.Listener {
                override fun onFirstFrame(itemId: String) {
                    sendEvent("onFirstFrame", mapOf("itemId" to itemId))
                }

                override fun onBuffering(itemId: String, isBuffering: Boolean) {
                    sendEvent("onBuffering", mapOf("itemId" to itemId, "isBuffering" to isBuffering))
                }

                override fun onPlaybackError(itemId: String, message: String) {
                    sendEvent("onPlaybackError", mapOf("itemId" to itemId, "message" to message))
                }

                override fun onCompleted(itemId: String) {
                    sendEvent("onCompleted", mapOf("itemId" to itemId))
                }
            }
            currentController = instance
        }

        OnDestroy {
            currentController?.release()
            currentController = null
        }

        Function("decoderBudget") {
            currentController?.decoderBudget() ?: PreloadController.DEFAULT_SLOT_BUDGET
        }

        AsyncFunction("setQueue") { items: List<FeedItemRecord>, currentIndex: Int, slotHint: Int ->
            controller.setQueue(
                items.map { PreloadController.QueueItem(it.id, it.uri, it.isHls) },
                currentIndex,
                slotHint,
            )
        }

        AsyncFunction("settle") { itemId: String ->
            controller.settle(itemId)
        }

        AsyncFunction("pauseActive") {
            controller.pauseActive()
        }

        AsyncFunction("seekActiveTo") { positionMs: Double ->
            controller.seekActiveTo(positionMs.toLong())
        }

        AsyncFunction("activeProgress") {
            val (position, duration) = controller.activeProgress()
            mapOf("positionMs" to position, "durationMs" to duration)
        }

        AsyncFunction("suspendAll") {
            controller.suspendAll()
        }

        AsyncFunction("resumeActive") {
            controller.resumeActive()
        }

        AsyncFunction("release") {
            controller.release()
        }

        View(Media3FeedView::class) {}
    }
}
