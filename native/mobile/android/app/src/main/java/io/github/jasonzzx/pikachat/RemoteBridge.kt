package io.github.jasonzzx.pikachat

import android.graphics.Color
import android.net.Uri
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class RemoteBridge(
    private val activity: MainActivity,
    private val webView: WebView,
) {
    private var nativeScript: ScriptHandler? = null
    private var themeScript: ScriptHandler? = null
    private var connectedOrigin: String? = null

    fun supportsRequiredFeatures(): Boolean =
        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    fun installForServer(origin: String, serverName: String) {
        connectedOrigin = origin
        nativeScript?.let {
            it.remove()
            nativeScript = null
            WebViewCompat.removeWebMessageListener(webView, NATIVE_HOST)
        }

        val rules = setOf(origin)
        WebViewCompat.addWebMessageListener(webView, NATIVE_HOST, rules) { _, message, sourceOrigin, isMainFrame, _ ->
            if (!isMainFrame || sourceOrigin.toString() != connectedOrigin) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            val json = runCatching { JSONObject(raw) }.getOrNull() ?: return@addWebMessageListener
            activity.runOnUiThread {
                when (json.optString("type")) {
                    "notify" -> {
                        val title = json.optString("title", "")
                        val body = json.optString("body", "")
                        val path = json.optString("path", "")
                        if (title.length <= 200 && body.length <= 500 && path.startsWith("/") && path.length <= 2048) {
                            activity.postReplyNotification(title, body, path)
                        }
                    }
                    "download" -> if (json.optString("url").length <= 2048) activity.downloadAttachment(Uri.parse(json.optString("url")))
                    "menu" -> activity.showServerMenuDialog()
                    "open" -> {
                        val screen = json.optString("screen", "")
                        if (screen == "list" || screen == "add") {
                            activity.showShell("?$screen")
                        }
                    }
                }
            }
        }

        val quotedName = JSONObject.quote(serverName)
        val quotedVersion = JSONObject.quote(BuildConfig.VERSION_NAME)
        val nativeJs = """
            if (window === top) {
              const post = (payload) => $NATIVE_HOST.postMessage(JSON.stringify(payload));
              window.pikaNative = Object.freeze({
                serverName: $quotedName,
                appVersion: $quotedVersion,
                notify: (i) => post({ type: "notify", ...i }),
                showServerMenu: () => post({ type: "menu" }),
                openServers: (screen) => post({ type: "open", screen }),
              });
              // A `download` anchor on a 302-ing /api/files URL would follow the redirect to the storage host, which leaves the app.
              document.addEventListener("click", (e) => {
                const a = e.target instanceof Element ? e.target.closest("a[download]") : null;
                if (!a || a.origin !== location.origin || !/^\/api\/files\/[^/]+$/.test(a.pathname)) return;
                e.preventDefault();
                post({ type: "download", url: a.href });
              }, true);
            }
        """.trimIndent()
        nativeScript = WebViewCompat.addDocumentStartJavaScript(webView, nativeJs, rules)

        installTheme(setOf(origin, SHELL_ORIGIN))
    }

    // Only drops the accepted origin: removing the listener when no new one follows crashed WebView 133 on the next page load.
    fun clearNative() {
        connectedOrigin = null
    }

    fun installTheme(rules: Set<String>) {
        themeScript?.let {
            it.remove()
            WebViewCompat.removeWebMessageListener(webView, THEME_HOST)
        }

        WebViewCompat.addWebMessageListener(webView, THEME_HOST, rules) { _, message, sourceOrigin, isMainFrame, _ ->
            if (!isMainFrame) return@addWebMessageListener
            val originStr = sourceOrigin.toString()
            if (originStr != SHELL_ORIGIN && originStr != connectedOrigin) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            val hex = runCatching { JSONObject(raw).optString("color", "") }.getOrNull() ?: return@addWebMessageListener
            if (!HEX_COLOR_RE.matches(hex)) return@addWebMessageListener
            activity.runOnUiThread { activity.applyBarColor(Color.parseColor(hex)) }
        }

        val themeJs = """
            if (window === top) {
              const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
              const toHex = (css) => {
                if (!css) return null;
                ctx.clearRect(0, 0, 1, 1);
                ctx.fillStyle = "#00000000";
                ctx.fillStyle = css;
                ctx.fillRect(0, 0, 1, 1);
                const d = ctx.getImageData(0, 0, 1, 1).data;
                if (d[3] === 0) return null;
                return "#" + ((1 << 24) + (d[0] << 16) + (d[1] << 8) + d[2]).toString(16).slice(1);
              };
              const sendColor = () => {
                const meta = document.querySelector('meta[name="theme-color"]');
                const raw = (meta && meta.getAttribute("content")) || (document.body ? getComputedStyle(document.body).backgroundColor : "");
                const hex = toHex(raw);
                if (hex) $THEME_HOST.postMessage(JSON.stringify({ color: hex }));
              };
              const attachObservers = () => {
                sendColor();
                const meta = document.querySelector('meta[name="theme-color"]');
                if (meta) {
                  new MutationObserver(sendColor).observe(meta, { attributes: true, attributeFilter: ["content"] });
                }
                new MutationObserver(() => requestAnimationFrame(sendColor)).observe(document.documentElement, {
                  attributes: true,
                  attributeFilter: ["class", "data-theme"],
                });
                window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => requestAnimationFrame(sendColor));
              };
              window.addEventListener("DOMContentLoaded", attachObservers, { once: true });
              // shell-ui's stylesheet is injected by a dynamic import, so its background is not applied yet at DOMContentLoaded.
              window.addEventListener("load", sendColor, { once: true });
            }
        """.trimIndent()
        themeScript = WebViewCompat.addDocumentStartJavaScript(webView, themeJs, rules)
    }

    companion object {
        const val SHELL_ORIGIN = "https://localhost"
        private const val NATIVE_HOST = "pikaNativeHost"
        private const val THEME_HOST = "pikaThemeHost"
        private val HEX_COLOR_RE = Regex("^#[0-9a-fA-F]{6}$")
    }
}
