package io.github.jasonzzx.pikachat

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.DrawableRes
import androidx.appcompat.app.AlertDialog
import androidx.core.graphics.ColorUtils

private val MEDIUM_TYPEFACE: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)

private fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

internal fun showThemedServerMenuDialog(
    activity: Activity,
    theme: ThemePalette,
    servers: List<ServerEntry>,
    connectedServerId: String?,
    onNavigate: (String) -> Unit,
) {
    val dialog = AlertDialog.Builder(activity).create()

    val root = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
    }

    root.addView(
        TextView(activity).apply {
            setText(R.string.server_menu_title)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = MEDIUM_TYPEFACE
            setTextColor(theme.popoverForeground)
            setPadding(activity.dp(24), activity.dp(20), activity.dp(24), activity.dp(12))
        },
    )

    if (servers.isNotEmpty()) {
        val serverList = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(activity.dp(12), activity.dp(2), activity.dp(12), activity.dp(2))
        }
        for (server in servers) {
            val isConnected = server.id == connectedServerId
            serverList.addView(
                buildMenuRow(
                    context = activity,
                    dialog = dialog,
                    theme = theme,
                    label = server.name,
                    active = isConnected,
                ) {
                    if (!isConnected) onNavigate("?connect=${Uri.encode(server.id)}")
                },
            )
        }

        val scrollView = MaxHeightScrollView(activity).apply {
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            addView(serverList, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        root.addView(scrollView, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

        val dividerParams = LinearLayout.LayoutParams(MATCH_PARENT, maxOf(1, activity.dp(1))).apply {
            topMargin = activity.dp(6)
            bottomMargin = activity.dp(6)
        }
        root.addView(View(activity).apply { setBackgroundColor(theme.border) }, dividerParams)
    }

    val actionsContainer = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(activity.dp(12), 0, activity.dp(12), activity.dp(4))
        addView(
            buildMenuRow(
                context = activity,
                dialog = dialog,
                theme = theme,
                label = activity.getString(R.string.server_menu_add),
                leadingIconRes = R.drawable.ic_add,
            ) { onNavigate("?add") },
        )
        addView(
            buildMenuRow(
                context = activity,
                dialog = dialog,
                theme = theme,
                label = activity.getString(R.string.server_menu_manage),
                leadingIconRes = R.drawable.ic_list,
            ) { onNavigate("?list") },
        )
    }
    root.addView(actionsContainer, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

    val footer = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.END
        setPadding(activity.dp(16), activity.dp(4), activity.dp(16), activity.dp(12))
        addView(
            TextView(activity).apply {
                setText(android.R.string.cancel)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                typeface = MEDIUM_TYPEFACE
                setTextColor(theme.mutedForeground)
                gravity = Gravity.CENTER
                minHeight = activity.dp(40)
                minWidth = activity.dp(64)
                setPadding(activity.dp(16), 0, activity.dp(16), 0)
                background = rowBackground(theme, active = false, cornerRadiusPx = activity.dp(10).toFloat())
                isClickable = true
                isFocusable = true
                setOnClickListener { dialog.dismiss() }
            },
        )
    }
    root.addView(footer, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

    dialog.setView(root)
    // Match AppCompat's 16dp dialog window inset so the card never touches screen edges on narrow viewports.
    val inset = activity.dp(16)
    val surface = GradientDrawable().apply {
        setColor(theme.popover)
        cornerRadius = activity.dp(20).toFloat()
        setStroke(maxOf(1, activity.dp(1)), theme.border)
    }
    dialog.window?.setBackgroundDrawable(InsetDrawable(surface, inset, inset, inset, inset))
    dialog.show()
}

private fun buildMenuRow(
    context: Context,
    dialog: AlertDialog,
    theme: ThemePalette,
    label: String,
    @DrawableRes leadingIconRes: Int? = null,
    active: Boolean = false,
    onClick: () -> Unit,
): View =
    LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = context.dp(48)
        setPadding(context.dp(12), context.dp(10), context.dp(12), context.dp(10))
        background = rowBackground(theme, active = active, cornerRadiusPx = context.dp(12).toFloat())
        isClickable = true
        isFocusable = true
        isSelected = active
        setOnClickListener {
            dialog.dismiss()
            onClick()
        }

        val iconSize = context.dp(18)
        if (leadingIconRes != null) {
            addView(
                ImageView(context).apply {
                    setImageResource(leadingIconRes)
                    imageTintList = ColorStateList.valueOf(theme.mutedForeground)
                    contentDescription = null
                },
                LinearLayout.LayoutParams(iconSize, iconSize).apply { marginEnd = context.dp(12) },
            )
        }

        addView(
            TextView(context).apply {
                text = label
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                typeface = if (active) MEDIUM_TYPEFACE else Typeface.DEFAULT
                setTextColor(theme.popoverForeground)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            },
            LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f),
        )

        if (active) {
            addView(
                ImageView(context).apply {
                    setImageResource(R.drawable.ic_check)
                    imageTintList = ColorStateList.valueOf(theme.primary)
                    contentDescription = null
                },
                LinearLayout.LayoutParams(iconSize, iconSize).apply { marginStart = context.dp(12) },
            )
        }
    }

private fun rowBackground(theme: ThemePalette, active: Boolean, cornerRadiusPx: Float): Drawable {
    val box = { color: Int ->
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = cornerRadiusPx
        }
    }
    return RippleDrawable(
        ColorStateList.valueOf(ColorUtils.setAlphaComponent(theme.popoverForeground, 28)),
        if (active) box(theme.accent) else null,
        box(Color.WHITE),
    )
}

private class MaxHeightScrollView(context: Context) : ScrollView(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val maxHeight = (resources.displayMetrics.heightPixels * 0.45f).toInt()
        val mode = MeasureSpec.getMode(heightMeasureSpec)
        val size = MeasureSpec.getSize(heightMeasureSpec)
        val capped = when (mode) {
            MeasureSpec.UNSPECIFIED -> MeasureSpec.makeMeasureSpec(maxHeight, MeasureSpec.AT_MOST)
            else -> MeasureSpec.makeMeasureSpec(minOf(size, maxHeight), mode)
        }
        super.onMeasure(widthMeasureSpec, capped)
    }
}
