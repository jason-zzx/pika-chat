package io.github.jasonzzx.pikachat

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Short-lived foreground service that keeps the process unfrozen while a reply
 * is actively streaming after the user leaves the app. Stops as soon as the
 * reply finishes, the user returns to the app, the task is swiped away, or the
 * OS short-service window (3 minutes on Android 14+) expires.
 */
class GenerationKeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            this.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            tapIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_streaming_title))
            .setContentText(getString(R.string.notification_streaming_body))
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(pendingIntent)
            .build()

        // Always promote before checking cancellation so ContextCompat.startForegroundService's
        // contract is satisfied even if stop() raced ahead of onStartCommand.
        val fgsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, fgsType)
        if (!keepAliveRequested) {
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int) {
        keepAliveRequested = false
        stopSelf(startId)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        keepAliveRequested = false
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    companion object {
        const val CHANNEL_ID = "streaming"
        private const val NOTIFICATION_ID = 1001

        @Volatile
        private var keepAliveRequested = false

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.notification_channel_streaming),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = context.getString(R.string.notification_channel_streaming_desc)
                setShowBadge(false)
            }
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }

        fun start(context: Context) {
            keepAliveRequested = true
            try {
                ContextCompat.startForegroundService(context, Intent(context, GenerationKeepAliveService::class.java))
            } catch (_: IllegalStateException) {
                // Android 12+ throws ForegroundServiceStartNotAllowedException (an IllegalStateException)
                // if the process already left the foreground window before this call ran.
                keepAliveRequested = false
            }
        }

        fun stop(context: Context) {
            keepAliveRequested = false
            context.stopService(Intent(context, GenerationKeepAliveService::class.java))
        }
    }
}
