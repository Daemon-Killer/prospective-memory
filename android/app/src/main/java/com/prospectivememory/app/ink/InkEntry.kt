package com.prospectivememory.app.ink

import android.content.Context
import android.content.Intent

/** Only import this class from outside `ink/`. */
object InkEntry {
    fun open(ctx: Context) {
        ctx.startActivity(
            Intent(ctx, InkCaptureActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            },
        )
    }
}
