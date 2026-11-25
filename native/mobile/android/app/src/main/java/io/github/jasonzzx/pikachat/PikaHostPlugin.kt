package io.github.jasonzzx.pikachat

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import kotlin.concurrent.thread

data class ServerEntry(val id: String, val name: String, val url: String) {
    fun toJson() = JSObject().apply {
        put("id", id)
        put("name", name)
        put("url", url)
    }
}

@CapacitorPlugin(name = "PikaHost")
class PikaHostPlugin : Plugin() {
    @Volatile
    var connectedServer: ServerEntry? = null
        private set

    internal fun clearConnectedServer() {
        connectedServer = null
    }

    @PluginMethod
    fun listServers(call: PluginCall) {
        val (servers, lastId) = readState()
        call.resolve(JSObject().apply {
            put("servers", JSArray(servers.map { it.toJson() }))
            put("lastServerId", lastId ?: JSONObject.NULL)
            put("activeServerId", connectedServer?.id ?: JSONObject.NULL)
        })
    }

    @PluginMethod
    fun saveServer(call: PluginCall) {
        val rawUrl = call.getString("url") ?: ""
        val normalized = normalizeOrigin(rawUrl)
        if (normalized == null) {
            call.reject("invalid url")
            return
        }
        val requestedId = call.getString("id")
        val rawName = (call.getString("name") ?: "").trim()
        val name = rawName.ifEmpty { Uri.parse(normalized).authority ?: normalized }.take(100)

        val (servers, lastId) = readState()
        val existing = requestedId?.let { id -> servers.find { it.id == id } }
        val entry = ServerEntry(existing?.id ?: UUID.randomUUID().toString(), name, normalized)
        val updated = if (existing != null) {
            servers.map { if (it.id == entry.id) entry else it }
        } else {
            servers + entry
        }
        writeState(updated, lastId)

        val main = activity as MainActivity
        main.runOnUiThread {
            if (existing != null && connectedServer?.id == entry.id) {
                if (existing.url != entry.url) {
                    connectedServer = null
                    main.destroyRemoteWebView()
                } else {
                    connectedServer = entry
                }
            }
            call.resolve(entry.toJson())
        }
    }

    @PluginMethod
    fun removeServer(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrEmpty()) {
            call.reject("missing id")
            return
        }
        val (servers, lastId) = readState()
        val target = servers.find { it.id == id }
        val remaining = servers.filter { it.id != id }
        val nextLast = if (lastId == id) null else lastId
        writeState(remaining, nextLast)

        val main = activity as MainActivity
        main.runOnUiThread {
            if (target != null) clearOriginData(target.url)
            if (connectedServer?.id == id) {
                connectedServer = null
                main.destroyRemoteWebView()
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val id = call.getString("id") ?: ""
        val (servers, _) = readState()
        val target = servers.find { it.id == id }
        if (target == null) {
            call.reject(context.getString(R.string.unknown_server))
            return
        }

        val main = activity as MainActivity
        main.runOnUiThread {
            if (!RemoteBridge.supportsRequiredFeatures()) {
                call.reject(context.getString(R.string.webview_unsupported))
                return@runOnUiThread
            }
            if (!main.isShellVisible) {
                call.resolve()
                return@runOnUiThread
            }
            connectedServer = target
            writeState(servers, target.id)
            main.connectToServer(target)
            call.resolve()
        }
    }

    @PluginMethod
    fun returnToServer(call: PluginCall) {
        val main = activity as MainActivity
        main.runOnUiThread {
            main.returnToServer()
            call.resolve()
        }
    }

    @PluginMethod
    fun setCanGoBack(call: PluginCall) {
        val canGoBack = call.getBoolean("canGoBack") ?: false
        val main = activity as MainActivity
        main.runOnUiThread {
            main.setShellCanGoBack(canGoBack)
            call.resolve()
        }
    }

    @PluginMethod
    fun checkForUpdates(call: PluginCall) {
        Updates.check(activity) {
            call.resolve()
        }
    }

    // Runs on the UI thread for renderer-initiated navigations on bridge.webView (shell-ui only).
    override fun shouldOverrideLoad(url: Uri): Boolean? {
        val origin = originOf(url)
        if (origin == RemoteBridge.SHELL_ORIGIN) return null
        if (origin != null || url.scheme == "mailto") {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, url))
            } catch (_: ActivityNotFoundException) {
            }
        }
        return true
    }

    // Runs on the UI thread for renderer-initiated navigations on remoteWebView.
    fun shouldOverrideRemoteLoad(url: Uri): Boolean {
        val origin = originOf(url)
        if (origin == RemoteBridge.SHELL_ORIGIN) return true
        val connected = connectedServer
        if (connected != null && origin == connected.url) {
            return openAttachment(url)
        }
        if (origin != null || url.scheme == "mailto") {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, url))
            } catch (_: ActivityNotFoundException) {
            }
        }
        return true
    }

    private fun isAttachment(url: Uri): Boolean {
        val segments = url.pathSegments
        return originOf(url) == connectedServer?.url && segments.size == 3 && segments[0] == "api" && segments[1] == "files"
    }

    // Same-origin `/api/files/<id>` on the connected server only; true when a download was started.
    fun downloadAttachment(url: Uri): Boolean {
        if (!isAttachment(url)) return false
        download(url.toString())
        return true
    }

    // Same validation as downloadAttachment; true when the file is being fetched to open with another app.
    fun openAttachment(url: Uri): Boolean {
        if (!isAttachment(url)) return false
        open(url.toString())
        return true
    }

    private val pendingDownloads = java.util.concurrent.ConcurrentHashMap<Long, String>()

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
            val name = pendingDownloads.remove(id) ?: return
            val dm = context.getSystemService(DownloadManager::class.java)
            val ok = dm.query(DownloadManager.Query().setFilterById(id)).use {
                it.moveToFirst() && it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL
            }
            toast(if (ok) context.getString(R.string.download_done, name) else context.getString(R.string.download_failed))
        }
    }

    override fun load() {
        ContextCompat.registerReceiver(context, downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED)
    }

    // Registered on the activity: recreate() after a renderer crash would otherwise leak it.
    override fun handleOnDestroy() {
        context.unregisterReceiver(downloadReceiver)
    }

    private fun toast(text: String) = Handler(Looper.getMainLooper()).post { Toast.makeText(context, text, Toast.LENGTH_LONG).show() }

    // The route answers 200 with Content-Disposition, or (S3 direct access) 302 to a presigned URL that
    // carries it in `response-content-disposition`. DownloadManager would name the file `<id>.bin` and
    // re-send our cookie to the storage host, so probe first and decide per status.
    private fun download(url: String) = thread(name = "pika-download") {
        runCatching {
            val cookie = CookieManager.getInstance().getCookie(url)
            val conn = openConnection(url, "HEAD", cookie)
            val code = conn.responseCode
            val disposition = conn.getHeaderField("Content-Disposition")
            val mime = conn.contentType
            val location = conn.getHeaderField("Location")
            conn.disconnect()

            val target = when {
                code in 200..299 -> url
                code in 300..399 && location != null -> URL(URL(url), location).toString()
                else -> return@runCatching toast(context.getString(R.string.download_failed))
            }
            val fileName = dispositionFileName(
                if (target == url) disposition else Uri.parse(target).getQueryParameter("response-content-disposition"),
            ) ?: URLUtil.guessFileName(target, null, mime)
            val request = DownloadManager.Request(Uri.parse(target))
            if (target == url && !cookie.isNullOrEmpty()) request.addRequestHeader("Cookie", cookie)
            request.setTitle(fileName)
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            if (!mime.isNullOrEmpty()) request.setMimeType(mime)
            pendingDownloads[context.getSystemService(DownloadManager::class.java).enqueue(request)] = fileName
        }.onFailure { toast(context.getString(R.string.download_failed)) }
    }

    // Fetches the file into cacheDir/open (session cookie to the app server only, never to a redirect
    // target) and offers it to other apps. No REQUEST_INSTALL_PACKAGES, so an .apk cannot be installed this way.
    private fun open(url: String) = thread(name = "pika-open") {
        runCatching {
            val cookie = CookieManager.getInstance().getCookie(url)
            var conn = openConnection(url, "GET", cookie)
            var disposition = conn.getHeaderField("Content-Disposition")
            if (conn.responseCode in 300..399) {
                val target = URL(URL(url), conn.getHeaderField("Location")).toString()
                conn.disconnect()
                conn = openConnection(target, "GET", null)
                disposition = Uri.parse(target).getQueryParameter("response-content-disposition")
            }
            if (conn.responseCode !in 200..299) {
                conn.disconnect()
                return@runCatching toast(context.getString(R.string.download_failed))
            }
            val mime = conn.contentType?.substringBefore(';')?.trim().takeUnless { it.isNullOrEmpty() } ?: "application/octet-stream"
            val name = (dispositionFileName(disposition) ?: URLUtil.guessFileName(url, null, mime))
                .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
            val file = File(File(context.cacheDir, "open").apply { mkdirs() }, name)
            conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
            conn.disconnect()

            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val chooser = Intent.createChooser(view, context.getString(R.string.open_with)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (view.resolveActivity(context.packageManager) == null) return@runCatching toast(context.getString(R.string.open_no_app))
            context.startActivity(chooser)
        }.onFailure { toast(context.getString(R.string.download_failed)) }
    }

    private fun openConnection(url: String, method: String, cookie: String?): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 8000
        conn.readTimeout = 30000
        if (!cookie.isNullOrEmpty()) conn.setRequestProperty("Cookie", cookie)
        return conn
    }

    // Prefers RFC 5987 `filename*=UTF-8''...` (the route sends both); strips path parts.
    private fun dispositionFileName(header: String?): String? {
        if (header == null) return null
        val raw = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(header)?.groupValues?.get(1)?.let { Uri.decode(it) }
            ?: Regex("filename=\"([^\"]*)\"").find(header)?.groupValues?.get(1)
        return raw?.substringAfterLast('/')?.ifEmpty { null }
    }

    fun getServers(): List<ServerEntry> = readState().first

    // Cookies only: WebStorage.deleteOrigin is a no-op on current WebViews (verified on 133), so localStorage stays.
    private fun clearOriginData(origin: String) {
        val cm = CookieManager.getInstance()
        val rawCookies = cm.getCookie(origin)
        if (!rawCookies.isNullOrEmpty()) {
            val isSecure = origin.startsWith("https://", ignoreCase = true)
            for (pair in rawCookies.split(";")) {
                val eq = pair.indexOf('=')
                val cookieName = (if (eq >= 0) pair.substring(0, eq) else pair).trim()
                if (cookieName.isEmpty()) continue
                val expired = buildString {
                    append(cookieName).append("=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/")
                    if (isSecure) append("; Secure")
                }
                cm.setCookie(origin, expired)
            }
            cm.flush()
        }
    }

    private fun prefs() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun readState(): Pair<List<ServerEntry>, String?> {
        val raw = prefs().getString(KEY_STATE, null) ?: return emptyList<ServerEntry>() to null
        // Written only by writeState, so the shape is trusted.
        val obj = JSONObject(raw)
        val arr = obj.getJSONArray("servers")
        val servers = (0 until arr.length()).map { i ->
            arr.getJSONObject(i).let { ServerEntry(it.getString("id"), it.getString("name"), it.getString("url")) }
        }
        return servers to obj.optString("lastServerId").ifEmpty { null }
    }

    private fun writeState(servers: List<ServerEntry>, lastServerId: String?) {
        val obj = JSONObject().apply {
            put("servers", JSONArray(servers.map { it.toJson() }))
            if (lastServerId != null) put("lastServerId", lastServerId)
        }
        prefs().edit().putString(KEY_STATE, obj.toString()).apply()
    }

    companion object {
        private const val PREFS_NAME = "pika"
        private const val KEY_STATE = "state"

        fun originOf(uri: Uri?): String? {
            val scheme = uri?.scheme?.lowercase() ?: return null
            if (scheme != "http" && scheme != "https") return null
            val host = uri.host?.lowercase() ?: return null
            val port = uri.port
            val defaultPort = (scheme == "http" && port == 80) || (scheme == "https" && port == 443)
            return if (port == -1 || defaultPort) "$scheme://$host" else "$scheme://$host:$port"
        }

        fun normalizeOrigin(raw: String): String? {
            val trimmed = raw.trim()
            if (trimmed.isEmpty() || trimmed.length > 2048) return null
            val withScheme = if (Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) {
                trimmed
            } else {
                "https://$trimmed"
            }
            return originOf(Uri.parse(withScheme))
        }
    }
}
