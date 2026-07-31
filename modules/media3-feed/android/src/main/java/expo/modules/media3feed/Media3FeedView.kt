package expo.modules.media3feed

import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.FrameLayout
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * The single persistent video surface for the feed screen. There should only ever be one of
 * these mounted at a time (see the comment on the JS side, `media3-feed/src/index.ts`) — it's
 * absolutely positioned and translated by a Reanimated worklet instead of being remounted per
 * item, because attaching a `Surface` to an already-prepared player is the expensive-but-cheap
 * operation this whole module trades on, and remounting the view would throw that away.
 */
@UnstableApi
class Media3FeedView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

    private val surfaceView = SurfaceView(context).apply {
        layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        )
    }

    init {
        addView(surfaceView)
        surfaceView.holder.addCallback(
            object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) {
                    Media3FeedModule.currentController?.attachSurface(holder.surface)
                }

                override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                    // No-op: the surface reference itself doesn't change on resize.
                }

                override fun surfaceDestroyed(holder: SurfaceHolder) {
                    Media3FeedModule.currentController?.detachSurface()
                }
            },
        )
    }
}
