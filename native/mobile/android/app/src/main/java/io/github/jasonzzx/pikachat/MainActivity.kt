package io.github.jasonzzx.pikachat

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowCompat
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebChromeClient
import com.getcapacitor.WebViewListener
import org.json.JSONObject

class MainActivity : BridgeActivity() {
    var isShellVisible: Boolean = true
        private set

    private lateinit var hostPlugin: PikaHostPlugin
    private lateinit var remoteWebChromeClient: BridgeWebChromeClient
    private lateinit var webViewContainer: ViewGroup

    private var remoteWebView: WebView? = null
    private var remoteBridge: RemoteBridge? = null
    private var serverMenuDialog: AlertDialog? = null
    private var shellAppearanceScript: ScriptHandler? = null

    private var shellTheme = ThemePalette.defaults(false)
    private var remoteTheme = ThemePalette.defaults(false)
    private var shellCanGoBack = false

    private val activeTheme: ThemePalette
        get() = if (isShellVisible) shellTheme else remoteTheme

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { _ -> }

    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            if (isShellVisible) {
                bridge.webView.evaluateJavascript("window.__pikaShellBack?.()", null)
                return
            }
            val wv = remoteWebView ?: return
            val rb = remoteBridge ?: return
            if (rb.webNavReady) {
                rb.dispatchBack()
                return
            }
            if (wv.canGoBack()) {
                wv.goBack()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(PikaHostPlugin::class.java)
        super.onCreate(savedInstanceState)
        hostPlugin = bridge.getPlugin("PikaHost").instance as PikaHostPlugin
        // Left over when the app was swiped away or killed with a temporary chat open.
        hostPlugin.flushTemporaryTopic()

        // Instantiate once before STARTED so ActivityResultContracts launchers register legally,
        // then reuse across remoteWebView instances for <input type="file"> / camera pickers.
        remoteWebChromeClient = BridgeWebChromeClient(bridge)

        WindowCompat.enableEdgeToEdge(window)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }

        java.io.File(cacheDir, "open").deleteRecursively()
        createNotificationChannel()
        val defaults = defaultThemeForConfig()
        shellTheme = defaults
        remoteTheme = defaults
        applyBarColor(shellTheme.background)

        val shellWebView = bridge.webView
        shellWebView.setBackgroundColor(shellTheme.background)
        webViewContainer = shellWebView.parent as ViewGroup

        RemoteBridge.installTheme(
            activity = this,
            webView = shellWebView,
            allowedOrigin = RemoteBridge.SHELL_ORIGIN,
            onTheme = { palette, _ -> applyShellTheme(palette) },
        )
        installShellAppearance(hostPlugin.readAppearance())

        bridge.addWebViewListener(object : WebViewListener() {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }

            // From here on WebView draws only its background or the new shell document, never the stale frame.
            override fun onPageCommitVisible(view: WebView, url: String) {
                if (!isShellVisible || view.visibility != View.INVISIBLE) return
                view.visibility = View.VISIBLE
                view.requestFocus()
                remoteWebView?.visibility = View.INVISIBLE
            }
        })

        onBackPressedDispatcher.addCallback(this, backCallback)
        updateBackEnabled()
    }

    internal fun isCurrentRemoteBridge(source: RemoteBridge): Boolean = remoteBridge === source

    fun setShellCanGoBack(canGoBack: Boolean) {
        shellCanGoBack = canGoBack
        updateBackEnabled()
    }

    fun onRemoteNavStateChanged(source: RemoteBridge) {
        if (remoteBridge === source) {
            updateBackEnabled()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createRemoteWebView(server: ServerEntry): Pair<WebView, RemoteBridge> {
        val wv = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(remoteTheme.background)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                userAgentString = bridge.webView.settings.userAgentString
                mixedContentMode = bridge.webView.settings.mixedContentMode
            }
            webChromeClient = remoteWebChromeClient
            setDownloadListener { url, _, _, _, _ ->
                hostPlugin.downloadAttachment(Uri.parse(url))
            }
        }

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(wv, true)

        val rb = RemoteBridge(
            activity = this,
            webView = wv,
            origin = server.url,
            serverName = server.name,
            connectedSince = hostPlugin.readConnectedSince(),
        )
        rb.install(onTheme = { palette, appearance -> applyRemoteTheme(rb, palette, appearance) })

        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                hostPlugin.shouldOverrideRemoteLoad(request.url)

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                rb.resetNavState()
                updateBackEnabled()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                val connected = hostPlugin.connectedServer
                val currentOrigin = PikaHostPlugin.originOf(url?.let { Uri.parse(it) })
                if (connected != null && currentOrigin == connected.url) {
                    maybeAskNotificationPermission()
                }
                updateBackEnabled()
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                updateBackEnabled()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                val connected = hostPlugin.connectedServer
                val reqOrigin = PikaHostPlugin.originOf(request.url)
                // A cancelled navigation is not a failure; WebView reports it as ERROR_UNKNOWN with Chromium's error name.
                if (
                    remoteWebView === view &&
                    request.isForMainFrame &&
                    connected != null &&
                    reqOrigin == connected.url &&
                    error.description != "net::ERR_ABORTED"
                ) {
                    val failedId = connected.id
                    // Post so destroyRemoteWebView never runs re-entrantly inside a WebViewClient callback.
                    window.decorView.post {
                        if (remoteWebView === view) {
                            if (isShellVisible) {
                                hostPlugin.clearConnectedServer()
                                destroyRemoteWebView()
                            } else {
                                showShell("?failed=${Uri.encode(failedId)}", dropRemote = true)
                            }
                        }
                    }
                    return
                }
                super.onReceivedError(view, request, error)
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (remoteWebView === view) {
                    if (isShellVisible) {
                        hostPlugin.clearConnectedServer()
                        destroyRemoteWebView()
                    } else {
                        recreate()
                    }
                }
                return true
            }
        }

        return wv to rb
    }

    fun connectToServer(server: ServerEntry) {
        dismissServerMenuDialog()
        destroyRemoteWebView()
        // A server never opened here has no theme cookie, so its sign-in page would render the web default.
        // Seed it with the shell's appearance (the web app's `mode:resolved:preset` format); after sign-in the
        // account's own preference rewrites it.
        val cookies = CookieManager.getInstance()
        if (!Regex("(?:^|;\\s*)pika_theme=").containsMatchIn(cookies.getCookie(server.url).orEmpty())) {
            val appearance = hostPlugin.readAppearance()
            val resolved = if (appearanceIsDark(appearance)) "dark" else "light"
            cookies.setCookie(
                server.url,
                "pika_theme=${appearance.mode}:$resolved:${appearance.preset}; Path=/; Max-Age=31536000; SameSite=Lax",
            )
        }
        remoteTheme = defaultThemeForConfig()
        val (wv, rb) = createRemoteWebView(server)
        remoteWebView = wv
        remoteBridge = rb
        webViewContainer.addView(wv, 0)
        wv.requestApplyInsets()
        isShellVisible = false
        bridge.webView.visibility = View.GONE
        wv.visibility = View.VISIBLE
        applyBarColor(remoteTheme.background)
        wv.loadUrl(server.url)
        wv.requestFocus()
        updateBackEnabled()
    }

    fun destroyRemoteWebView() {
        val wv = remoteWebView ?: return
        // Every caller drops the page for good (server switch or removal, finishing, recreate), which leaves its
        // temporary chat. Backgrounding never gets here.
        hostPlugin.flushTemporaryTopic()
        remoteWebView = null
        remoteBridge = null
        wv.stopLoading()
        wv.webChromeClient = null
        wv.webViewClient = WebViewClient()
        (wv.parent as? ViewGroup)?.removeView(wv)
        wv.destroy()
        updateBackEnabled()
    }

    fun downloadAttachment(url: Uri) = hostPlugin.downloadAttachment(url)

    fun saveTemporaryTopic(origin: String, topicId: String?) = hostPlugin.saveTemporaryTopic(origin, topicId)

    fun showShell(query: String, dropRemote: Boolean = false) {
        dismissServerMenuDialog()
        if (dropRemote) {
            hostPlugin.clearConnectedServer()
            destroyRemoteWebView()
        }
        val fromServer = !isShellVisible && remoteWebView != null
        isShellVisible = true
        shellCanGoBack = remoteWebView != null
        if (fromServer) {
            // The hidden shell WebView still holds its previous document's last frame, painted with the
            // appearance the shell had then. Keep the server on screen until onPageCommitVisible. shell-ui
            // mirrors this server's appearance, so keep the server's palette until shell-ui reports its own.
            shellTheme = remoteTheme
            bridge.webView.setBackgroundColor(shellTheme.background)
            bridge.webView.visibility = View.INVISIBLE
        } else {
            remoteWebView?.visibility = View.INVISIBLE
            bridge.webView.visibility = View.VISIBLE
        }
        bridge.webView.bringToFront()
        bridge.webView.loadUrl("${RemoteBridge.SHELL_ORIGIN}/$query")
        bridge.webView.requestFocus()
        applyBarColor(shellTheme.background)
        updateBackEnabled()
    }

    fun returnToServer() {
        val wv = remoteWebView
        if (wv == null || hostPlugin.connectedServer == null) {
            showShell("?list", dropRemote = true)
            return
        }
        dismissServerMenuDialog()
        isShellVisible = false
        bridge.webView.visibility = View.GONE
        wv.visibility = View.VISIBLE
        wv.requestFocus()
        applyBarColor(remoteTheme.background)
        updateBackEnabled()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // BridgeActivity.load() invokes onNewIntent() during super.onCreate() before hostPlugin is initialized.
        val wv = remoteWebView ?: return
        if (!::hostPlugin.isInitialized) return
        val serverId = intent.getStringExtra(EXTRA_SERVER_ID) ?: return
        val path = intent.getStringExtra(EXTRA_PATH) ?: return
        val connected = hostPlugin.connectedServer ?: return
        // The activity is exported: extras may come from another app, so re-check the path.
        if (connected.id == serverId && path.startsWith("/")) {
            if (isShellVisible) returnToServer()
            wv.loadUrl(connected.url + path)
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        dismissServerMenuDialog()
        destroyRemoteWebView()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Re-apply after Capacitor's SystemBars.setStyle resets decorView backgroundColor.
        applyBarColor(activeTheme.background)
    }

    private fun defaultThemeForConfig() = ThemePalette.defaults(appearanceIsDark(hostPlugin.readAppearance()))

    private fun appearanceIsDark(appearance: ShellAppearance) = when (appearance.mode) {
        "dark" -> true
        "light" -> false
        else -> (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    }

    private fun applyShellTheme(palette: ThemePalette) {
        shellTheme = palette
        bridge.webView.setBackgroundColor(palette.background)
        if (isShellVisible) applyBarColor(palette.background)
    }

    private fun applyRemoteTheme(source: RemoteBridge, palette: ThemePalette, appearance: ShellAppearance?) {
        if (remoteBridge !== source) return
        if (appearance != null && appearance != hostPlugin.readAppearance()) {
            hostPlugin.saveAppearance(appearance)
            installShellAppearance(appearance)
        }
        remoteTheme = palette
        remoteWebView?.setBackgroundColor(palette.background)
        if (!isShellVisible) applyBarColor(palette.background)
    }

    // Shell pages take the last server's appearance before their first frame: a light frame painted first would
    // stay in the hidden WebView after auto-connect and flash on the next showShell. Re-registered on change,
    // since the shell reloads on every showShell.
    private fun installShellAppearance(appearance: ShellAppearance) {
        shellAppearanceScript?.remove()
        val mode = JSONObject.quote(appearance.mode)
        shellAppearanceScript = WebViewCompat.addDocumentStartJavaScript(
            bridge.webView,
            """
            {
              const systemDark = matchMedia("(prefers-color-scheme: dark)");
              const applyDark = () => document.documentElement.classList.toggle("dark", $mode === "dark" || ($mode === "system" && systemDark.matches));
              applyDark();
              systemDark.addEventListener("change", applyDark);
              // "default" and presets this build does not know match no [data-theme] block: base tokens apply.
              document.documentElement.dataset.theme = ${JSONObject.quote(appearance.preset)};
            }
            """.trimIndent(),
            setOf(RemoteBridge.SHELL_ORIGIN),
        )
    }

    private fun applyBarColor(color: Int) {
        val decor = window.decorView
        decor.setBackgroundColor(color)
        val lightBars = ColorUtils.calculateLuminance(color) > 0.5
        WindowCompat.getInsetsController(window, decor).apply {
            isAppearanceLightStatusBars = lightBars
            isAppearanceLightNavigationBars = lightBars
        }
    }

    private fun dismissServerMenuDialog() {
        serverMenuDialog?.dismiss()
        serverMenuDialog = null
    }

    private fun updateBackEnabled() {
        val wv = remoteWebView
        val rb = remoteBridge
        val shouldIntercept = when {
            serverMenuDialog?.isShowing == true -> false // AlertDialog handles its own Back dismissal natively
            isShellVisible -> shellCanGoBack
            wv != null -> if (rb != null && rb.webNavReady) rb.webCanGoBack else wv.canGoBack()
            else -> false
        }
        backCallback.isEnabled = shouldIntercept
    }

    fun showServerMenuDialog() {
        if (isFinishing || isDestroyed || isShellVisible) return
        dismissServerMenuDialog()
        val dialog = showThemedServerMenuDialog(
            activity = this,
            theme = activeTheme,
            servers = hostPlugin.getServers(),
            connectedServerId = hostPlugin.connectedServer?.id,
            onNavigate = { query -> showShell(query) },
        )
        serverMenuDialog = dialog
        dialog.setOnDismissListener {
            if (serverMenuDialog === dialog) {
                serverMenuDialog = null
                updateBackEnabled()
            }
        }
        updateBackEnabled()
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
