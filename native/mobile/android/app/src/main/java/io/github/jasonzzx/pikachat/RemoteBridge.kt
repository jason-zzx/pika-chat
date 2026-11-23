package io.github.jasonzzx.pikachat

import android.graphics.Color
import android.net.Uri
import android.webkit.WebView
import androidx.core.graphics.ColorUtils
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

data class ThemePalette(
    val isDark: Boolean,
    val background: Int,
    val popover: Int,
    val popoverForeground: Int,
    val mutedForeground: Int,
    val accent: Int,
    val primary: Int,
    val border: Int,
) {
    companion object {
        fun defaults(isDark: Boolean) = ThemePalette(
            isDark = isDark,
            background = Color.parseColor(if (isDark) "#0a0a0a" else "#fafafa"),
            popover = Color.parseColor(if (isDark) "#171717" else "#ffffff"),
            popoverForeground = Color.parseColor(if (isDark) "#fafafa" else "#0a0a0a"),
            mutedForeground = Color.parseColor(if (isDark) "#a3a3a3" else "#737373"),
            accent = Color.parseColor(if (isDark) "#262626" else "#f5f5f5"),
            primary = Color.parseColor(if (isDark) "#fafafa" else "#171717"),
            border = Color.parseColor(if (isDark) "#1affffff" else "#e5e5e5"),
        )
    }
}

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
            val json = runCatching { JSONObject(raw) }.getOrNull() ?: return@addWebMessageListener
            val palette = parseThemePalette(json) ?: return@addWebMessageListener
            activity.runOnUiThread {
                if (!activity.isFinishing && !activity.isDestroyed) activity.applyTheme(palette)
            }
        }

        val themeJs = """
            if (window === top) {
              const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
              const sample = (css) => {
                if (!ctx || !css) return null;
                ctx.clearRect(0, 0, 1, 1);
                ctx.fillStyle = "#00000000";
                ctx.fillStyle = css;
                ctx.fillRect(0, 0, 1, 1);
                const d = ctx.getImageData(0, 0, 1, 1).data;
                return d[3] === 0 ? null : d;
              };
              const hexByte = (n) => n.toString(16).padStart(2, "0");
              const toHex = (css, opaque) => {
                const d = sample(css);
                if (!d) return null;
                const rgb = hexByte(d[0]) + hexByte(d[1]) + hexByte(d[2]);
                return opaque || d[3] === 255 ? "#" + rgb : "#" + hexByte(d[3]) + rgb;
              };
              let lastPayload = "";
              const sendColor = () => {
                if (!document.body) return;
                const bodyStyle = getComputedStyle(document.body);
                const probe = document.createElement("span");
                probe.style.display = "none";
                document.body.append(probe);
                const readVar = (name) => {
                  if (!bodyStyle.getPropertyValue(name).trim()) return "";
                  probe.style.color = "";
                  probe.style.color = "var(" + name + ")";
                  return getComputedStyle(probe).color;
                };
                const meta = document.querySelector('meta[name="theme-color"]');
                const bgSample = sample((meta && meta.getAttribute("content")) || readVar("--background") || bodyStyle.backgroundColor);
                const isDark = bgSample
                  ? (0.2126 * bgSample[0] + 0.7152 * bgSample[1] + 0.0722 * bgSample[2]) < 128
                  : document.documentElement.classList.contains("dark") ||
                    (!document.documentElement.classList.contains("light") && window.matchMedia("(prefers-color-scheme: dark)").matches);
                const background = bgSample ? "#" + hexByte(bgSample[0]) + hexByte(bgSample[1]) + hexByte(bgSample[2]) : null;
                const payload = {
                  isDark,
                  color: background,
                  popover: toHex(readVar("--popover"), true),
                  popoverForeground: toHex(readVar("--popover-foreground") || readVar("--foreground") || bodyStyle.color, false),
                  mutedForeground: toHex(readVar("--muted-foreground"), false),
                  accent: toHex(readVar("--accent"), false),
                  primary: toHex(readVar("--primary"), false),
                  border: toHex(readVar("--border"), false),
                };
                probe.remove();
                const encoded = JSON.stringify(payload);
                if (encoded === lastPayload) return;
                lastPayload = encoded;
                $THEME_HOST.postMessage(encoded);
              };
              const attachObservers = () => {
                sendColor();
                const schedule = () => requestAnimationFrame(sendColor);
                const meta = document.querySelector('meta[name="theme-color"]');
                if (meta) {
                  new MutationObserver(schedule).observe(meta, { attributes: true, attributeFilter: ["content"] });
                }
                new MutationObserver(schedule).observe(document.documentElement, {
                  attributes: true,
                  attributeFilter: ["class", "data-theme", "style"],
                });
                window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule);
              };
              window.addEventListener("DOMContentLoaded", attachObservers, { once: true });
              // shell-ui's stylesheet is injected by a dynamic import, so its background is not applied yet at DOMContentLoaded.
              window.addEventListener("load", sendColor, { once: true });
            }
        """.trimIndent()
        themeScript = WebViewCompat.addDocumentStartJavaScript(webView, themeJs, rules)
    }

    private fun parseThemePalette(json: JSONObject): ThemePalette? {
        val parsedBg = parseHexColor(json.optString("color"), opaqueOnly = true)
        val isDark = when {
            json.has("isDark") -> json.optBoolean("isDark")
            parsedBg != null -> ColorUtils.calculateLuminance(parsedBg) <= 0.5
            else -> return null
        }
        val fallback = ThemePalette.defaults(isDark)
        return ThemePalette(
            isDark = isDark,
            background = parsedBg ?: fallback.background,
            popover = parseHexColor(json.optString("popover"), opaqueOnly = true) ?: fallback.popover,
            popoverForeground = parseHexColor(json.optString("popoverForeground")) ?: fallback.popoverForeground,
            mutedForeground = parseHexColor(json.optString("mutedForeground")) ?: fallback.mutedForeground,
            accent = parseHexColor(json.optString("accent")) ?: fallback.accent,
            primary = parseHexColor(json.optString("primary")) ?: fallback.primary,
            border = parseHexColor(json.optString("border")) ?: fallback.border,
        )
    }

    private fun parseHexColor(raw: String, opaqueOnly: Boolean = false): Int? {
        val regex = if (opaqueOnly) RGB_HEX_RE else ARGB_HEX_RE
        if (!regex.matches(raw)) return null
        return Color.parseColor(raw)
    }

    companion object {
        const val SHELL_ORIGIN = "https://localhost"
        private const val NATIVE_HOST = "pikaNativeHost"
        private const val THEME_HOST = "pikaThemeHost"
        private val RGB_HEX_RE = Regex("^#[0-9a-fA-F]{6}$")
        private val ARGB_HEX_RE = Regex("^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
    }
}
