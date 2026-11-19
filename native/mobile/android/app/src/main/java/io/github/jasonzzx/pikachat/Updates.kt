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

    fun check(activity: Activity, manual: Boolean) {
        thread(name = "pika-update-check") {
            val result = fetchLatestRelease()
            activity.runOnUiThread {
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                if (result == null) {
                    if (manual) {
                        AlertDialog.Builder(activity)
                            .setTitle(R.string.update_error_title)
                            .setMessage(R.string.update_error_body)
                            .setPositiveButton(R.string.update_download) { _, _ ->
                                openUrl(activity, RELEASES_URL)
                            }
                            .setNegativeButton(R.string.update_later, null)
                            .show()
                    }
                    return@runOnUiThread
                }

                val (tagName, htmlUrl) = result
                val currentTag = "v${BuildConfig.VERSION_NAME}"
                if (tagName == currentTag) {
                    if (manual) {
                        AlertDialog.Builder(activity)
                            .setTitle(R.string.update_up_to_date_title)
                            .setMessage(activity.getString(R.string.update_up_to_date_body, BuildConfig.VERSION_NAME))
                            .setPositiveButton(R.string.ok, null)
                            .show()
                    }
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

    private fun openUrl(activity: Activity, url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        activity.startActivity(intent)
    }
}
