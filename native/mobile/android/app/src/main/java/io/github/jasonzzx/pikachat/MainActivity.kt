package io.github.jasonzzx.pikachat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebViewClient
import com.getcapacitor.WebViewListener

class MainActivity : BridgeActivity() {
    lateinit var remoteBridge: RemoteBridge
        private set

    private lateinit var hostPlugin: PikaHostPlugin
    private var lastBarColor = 0

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }

    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val wv = bridge.webView
            val currentOrigin = PikaHostPlugin.originOf(wv.url?.let { Uri.parse(it) })
            val connected = hostPlugin.connectedServer

            if (connected != null && currentOrigin == connected.url) {
                val list = wv.copyBackForwardList()
                val prevUrl = list.currentIndex.takeIf { it > 0 }?.let { list.getItemAtIndex(it - 1).url }
                if (PikaHostPlugin.originOf(prevUrl?.let { Uri.parse(it) }) == connected.url) {
                    wv.goBack()
                } else {
                    showShell("?list")
                }
                return
            }

            // On shell-ui (or before any server is connected): delegate to system default (background app).
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(PikaHostPlugin::class.java)
        super.onCreate(savedInstanceState)
        hostPlugin = bridge.getPlugin("PikaHost").instance as PikaHostPlugin

        WindowCompat.enableEdgeToEdge(window)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }

        java.io.File(cacheDir, "open").deleteRecursively()
        createNotificationChannel()
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        applyBarColor(Color.parseColor(if (night) "#0a0a0a" else "#fafafa"))

        val wv = bridge.webView
        remoteBridge = RemoteBridge(
            activity = this,
            webView = wv,
        )
        remoteBridge.installTheme(setOf(RemoteBridge.SHELL_ORIGIN))

        wv.setDownloadListener { url, _, _, _, _ ->
            hostPlugin.downloadAttachment(Uri.parse(url))
        }

        bridge.setWebViewClient(object : BridgeWebViewClient(bridge) {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                val connected = hostPlugin.connectedServer
                val reqOrigin = PikaHostPlugin.originOf(request.url)
                // A cancelled navigation is not a failure; WebView reports it as ERROR_UNKNOWN with Chromium's error name.
                if (request.isForMainFrame && connected != null && reqOrigin == connected.url && error.description != "net::ERR_ABORTED") {
                    showShell("?failed=${Uri.encode(connected.id)}")
                    return
                }
                super.onReceivedError(view, request, error)
            }
        })

        bridge.addWebViewListener(object : WebViewListener() {
            override fun onPageLoaded(webView: WebView) {
                val connected = hostPlugin.connectedServer ?: return
                val currentOrigin = PikaHostPlugin.originOf(webView.url?.let { Uri.parse(it) })
                if (currentOrigin == connected.url) {
                    maybeAskNotificationPermission()
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        })

        onBackPressedDispatcher.addCallback(this, backCallback)
        Updates.check(this, manual = false)
    }

    fun connectToServer(server: ServerEntry) {
        remoteBridge.installForServer(server.url, server.name)
        bridge.webView.loadUrl(server.url)
    }

    fun downloadAttachment(url: Uri) = hostPlugin.downloadAttachment(url)

    fun showShell(query: String) {
        bridge.webView.loadUrl("${RemoteBridge.SHELL_ORIGIN}/$query")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val serverId = intent.getStringExtra(EXTRA_SERVER_ID) ?: return
        val path = intent.getStringExtra(EXTRA_PATH) ?: return
        val connected = hostPlugin.connectedServer ?: return
        // The activity is exported: extras may come from another app, so re-check the path.
        if (connected.id == serverId && path.startsWith("/")) {
            bridge.webView.loadUrl(connected.url + path)
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Re-apply after Capacitor's SystemBars.setStyle resets decorView backgroundColor.
        applyBarColor(lastBarColor)
    }

    fun applyBarColor(color: Int) {
        lastBarColor = color
        val decor = window.decorView
        decor.setBackgroundColor(color)
        bridge.webView.setBackgroundColor(color)
        val lightBars = ColorUtils.calculateLuminance(color) > 0.5
        WindowCompat.getInsetsController(window, decor).apply {
            isAppearanceLightStatusBars = lightBars
            isAppearanceLightNavigationBars = lightBars
        }
    }

    fun showServerMenuDialog() {
        val connected = hostPlugin.connectedServer
        val servers = hostPlugin.getServers()
        val labels = (servers.map { it.name } + getString(R.string.server_menu_add) + getString(R.string.server_menu_manage)).toTypedArray()

        val checkedIndex = servers.indexOfFirst { it.id == connected?.id }

        AlertDialog.Builder(this)
            .setTitle(R.string.server_menu_title)
            .setSingleChoiceItems(labels, checkedIndex) { dialog, which ->
                dialog.dismiss()
                when {
                    which < servers.size -> {
                        val picked = servers[which]
                        if (picked.id != connected?.id) {
                            showShell("?connect=${Uri.encode(picked.id)}")
                        }
                    }
                    which == servers.size -> showShell("?add")
                    else -> showShell("?list")
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_REPLIES,
            getString(R.string.notification_channel_replies),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = getString(R.string.notification_channel_replies_desc)
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    private fun maybeAskNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_ASKED_NOTIF, false)) return
        prefs.edit().putBoolean(KEY_ASKED_NOTIF, true).apply()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    fun postReplyNotification(title: String, body: String, path: String) {
        val connected = hostPlugin.connectedServer ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_SERVER_ID, connected.id)
            putExtra(EXTRA_PATH, path)
        }
        // Unique across process restarts, so a new notification never replaces an older one's intent.
        val id = System.currentTimeMillis().toInt()
        val pendingIntent = PendingIntent.getActivity(
            this,
            id,
            tapIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_REPLIES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        NotificationManagerCompat.from(this).notify(id, notification)
    }

    companion object {
        private const val PREFS_NAME = "pika"
        private const val KEY_ASKED_NOTIF = "asked_notif"
        private const val CHANNEL_REPLIES = "replies"
        private const val EXTRA_SERVER_ID = "pika_server_id"
        private const val EXTRA_PATH = "pika_path"
    }
}
