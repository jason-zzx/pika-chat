package io.github.jasonzzx.pikachat

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

object Updates {
    private const val RELEASES_URL = "https://github.com/jason-zzx/pika-chat/releases/latest"
    private const val LATEST_API = "https://api.github.com/repos/jason-zzx/pika-chat/releases/latest"

    fun check(activity: Activity, onComplete: () -> Unit = {}) {
        thread(name = "pika-update-check") {
            val result = fetchLatestRelease()
            activity.runOnUiThread {
                onComplete()
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                if (result == null) {
                    AlertDialog.Builder(activity)
                        .setTitle(R.string.update_error_title)
                        .setMessage(R.string.update_error_body)
                        .setPositiveButton(R.string.update_download) { _, _ ->
                            openUrl(activity, RELEASES_URL)
                        }
                        .setNegativeButton(R.string.update_later, null)
                        .show()
                    return@runOnUiThread
                }

                val (tagName, htmlUrl) = result
                if (!isNewerVersion(tagName, BuildConfig.VERSION_NAME)) {
                    AlertDialog.Builder(activity)
                        .setTitle(R.string.update_up_to_date_title)
                        .setMessage(activity.getString(R.string.update_up_to_date_body, BuildConfig.VERSION_NAME))
                        .setPositiveButton(R.string.ok, null)
                        .show()
                    return@runOnUiThread
                }

                val displayVersion = tagName.removePrefix("v")
                AlertDialog.Builder(activity)
                    .setTitle(R.string.update_title)
                    .setMessage(activity.getString(R.string.update_body, displayVersion))
                    .setPositiveButton(R.string.update_download) { _, _ ->
                        openUrl(activity, htmlUrl)
                    }
                    .setNegativeButton(R.string.update_later, null)
                    .show()
            }
        }
    }

    private fun fetchLatestRelease(): Pair<String, String>? {
        val conn = URL(LATEST_API).openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "GET"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            if (conn.responseCode !in 200..299) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            val tag = json.optString("tag_name", "")
            val url = json.optString("html_url", "")
            if (tag.isEmpty() || url.isEmpty()) null else tag to url
        } catch (e: Exception) {
            Log.w("PikaUpdates", "Update check failed: ${e.message}")
            null
        } finally {
            conn.disconnect()
        }
    }

    private data class Semver(
        val major: Int,
        val minor: Int,
        val patch: Int,
        val pre: List<String>,
    )

    private val semverRegex = Regex("""^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$""")

    internal fun isNewerVersion(candidate: String, current: String): Boolean {
        val a = parseSemver(candidate) ?: return false
        val b = parseSemver(current) ?: return false

        if (a.major != b.major) return a.major > b.major
        if (a.minor != b.minor) return a.minor > b.minor
        if (a.patch != b.patch) return a.patch > b.patch

        if (a.pre.isEmpty() && b.pre.isEmpty()) return false
        if (a.pre.isEmpty()) return true
        if (b.pre.isEmpty()) return false

        val len = maxOf(a.pre.size, b.pre.size)
        for (i in 0 until len) {
            val ai = a.pre.getOrNull(i) ?: return false
            val bi = b.pre.getOrNull(i) ?: return true
            val cmp = comparePreIdentifier(ai, bi)
            if (cmp != 0) return cmp > 0
        }
        return false
    }

    private fun parseSemver(version: String): Semver? {
        val match = semverRegex.matchEntire(version.trim()) ?: return null
        val (major, minor, patch, pre) = match.destructured
        return Semver(
            major = major.toInt(),
            minor = minor.toInt(),
            patch = patch.toInt(),
            pre = if (pre.isEmpty()) emptyList() else pre.split('.'),
        )
    }

    private fun comparePreIdentifier(a: String, b: String): Int {
        val aNum = a.all { it.isDigit() }
        val bNum = b.all { it.isDigit() }
        if (aNum && bNum) return a.toInt().compareTo(b.toInt())
        if (aNum != bNum) return if (aNum) -1 else 1
        return a.compareTo(b)
    }

    private fun openUrl(activity: Activity, url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        activity.startActivity(intent)
    }
}
