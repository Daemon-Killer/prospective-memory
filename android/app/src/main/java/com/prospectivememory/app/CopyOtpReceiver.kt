package com.prospectivememory.app

import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast

class CopyOtpReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val code = intent.getStringExtra(EXTRA_OTP)?.trim().orEmpty()
        if (code.isEmpty()) return
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("otp", code))
        Toast.makeText(context, "OTP copied", Toast.LENGTH_SHORT).show()
    }

    companion object {
        const val EXTRA_OTP = "otp"
        const val ACTION = "com.prospectivememory.app.COPY_OTP"
    }
}
