package com.remy.reminders.sensory

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Android background service that intercepts system notifications, applies
 * package filtering, enforces native OTP quarantine, writes vetted alerts to
 * an atomic SharedPreferences buffer, and emits realtime bridge events.
 */
class RemyNotificationListenerService : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        isConnected = true
        instance = this
        Log.d(TAG, "RemyNotificationListenerService connected to Android Notification System.")
        processActiveNotifications()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        if (instance == this) {
            instance = null
        }
        Log.d(TAG, "RemyNotificationListenerService disconnected from Android Notification System.")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                requestRebind(ComponentName(this, RemyNotificationListenerService::class.java))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to request rebind for NotificationListenerService", e)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isConnected = false
        if (instance == this) {
            instance = null
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)

        if (sbn == null) return
        val notification = sbn.notification ?: return
        val packageName = sbn.packageName ?: return

        // 1. Never monitor Remy's own notifications
        if (packageName == applicationContext.packageName) {
            return
        }

        // 2. Filter ongoing / persistent / foreground service alerts (media controls, calls, progress)
        val flags = notification.flags
        val isOngoing = (flags and Notification.FLAG_ONGOING_EVENT) != 0
        val isForeground = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            (flags and Notification.FLAG_FOREGROUND_SERVICE) != 0
        } else {
            false
        }
        if (isOngoing || isForeground) {
            return
        }

        // 3. Package Whitelist / Blacklist Filter
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!isPackagePermitted(packageName, prefs)) {
            return
        }

        // 4. Extract text content
        val extras = notification.extras
        var title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        if (title.isEmpty()) {
            title = extras?.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString()?.trim() ?: ""
        }
        var text = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
        if (text.isNullOrEmpty()) {
            text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""
        }
        if (text.isEmpty()) {
            val lines = extras?.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            if (!lines.isNullOrEmpty()) {
                text = lines.filterNotNull().joinToString(" ") { it.toString().trim() }
            }
        }
        val subText = extras?.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim()
        if (!subText.isNullOrEmpty()) {
            text = if (text.isEmpty()) subText else "$text $subText"
        }

        if (title.isEmpty() && text.isEmpty()) {
            return
        }

        // 5. Strict Native Security & OTP Quarantine Gate
        if (SensorySecurityFilter.isSensitiveAuth(title, text)) {
            recordQuarantine(prefs)
            Log.i(TAG, "Quarantined sensitive authentication notification from package: $packageName")
            return
        }

        // 6. Assemble Ingress Payload Envelope
        val id = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        val postTime = sbn.postTime

        val payload = JSONObject().apply {
            put("id", id)
            put("key", sbn.key ?: "")
            put("packageName", packageName)
            put("title", title)
            put("text", text)
            put("subText", subText ?: JSONObject.NULL)
            put("timestamp", timestamp)
            put("postTime", postTime)
        }

        // 7. Enqueue into persistent SharedPreferences queue (FIFO cap = 100)
        enqueuePendingNotification(prefs, payload)

        // 8. Emit live event to React Native runtime if active
        RemySensoryModule.emitNotification(payload)

        // 9. Active Notification Tray Management & Promotional Clearing
        val autoClearPromos = prefs.getBoolean(PREF_AUTO_CLEAR_PROMOS, true)
        val autoSnoozeNoise = prefs.getBoolean(PREF_AUTO_SNOOZE_NOISE, false)
        val autoClearScam = prefs.getBoolean(PREF_AUTO_CLEAR_SCAM, true)

        val isWhatsapp = WHATSAPP_PACKAGES.contains(packageName) || packageName.startsWith("com.whatsapp")
        val isSms = isSmsPackage(packageName, applicationContext)
        val isScam = isScamNotification(packageName, title, text, applicationContext)
        val isPromo = isPromotionalNotification(packageName, title, text, applicationContext)

        if (isScam) {
            // Automatically trigger mark-as-read and dismiss scam SMS / fraudulent alerts
            if (isWhatsapp || isSms) {
                tryMarkAsRead(notification, applicationContext)
            }
            if (autoClearScam) {
                if (sbn.key != null) {
                    cancelNotification(sbn.key)
                } else {
                    @Suppress("DEPRECATION")
                    cancelNotification(packageName, sbn.tag, sbn.id)
                }
                Log.i(TAG, "Marked as read & dismissed scam notification: $packageName (${sbn.key})")
            }
        } else if (isPromo) {
            if (isWhatsapp || isSms) {
                // Mark conversation as read in WhatsApp / SMS inbox and clear shade
                tryMarkAsRead(notification, applicationContext)
                if (autoClearPromos) {
                    if (sbn.key != null) {
                        cancelNotification(sbn.key)
                    } else {
                        @Suppress("DEPRECATION")
                        cancelNotification(packageName, sbn.tag, sbn.id)
                    }
                    Log.i(TAG, "Marked as read & dismissed promotional messaging alert: $packageName (${sbn.key})")
                }
            } else if (autoClearPromos) {
                if (sbn.key != null) {
                    cancelNotification(sbn.key)
                } else {
                    @Suppress("DEPRECATION")
                    cancelNotification(packageName, sbn.tag, sbn.id)
                }
                Log.i(TAG, "Actively dismissed promotional notification from tray: $packageName (${sbn.key})")
            }
        } else if (isNoise(title, text) && autoSnoozeNoise) {
            if (sbn.key != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    snoozeNotification(sbn.key, 3600000L)
                    Log.i(TAG, "Snoozed noise notification from tray: $packageName (${sbn.key})")
                } else {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        cancelNotification(sbn.key)
                    }
                }
            }
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
        // Passive ingress; dismissals in shade do not affect sensory suggestion review queue
    }

    private fun isPackagePermitted(pkg: String, prefs: SharedPreferences): Boolean {
        val normalizedPkg = pkg.trim().lowercase()
        val autoClearPromos = prefs.getBoolean(PREF_AUTO_CLEAR_PROMOS, true)
        val autoClearScam = prefs.getBoolean(PREF_AUTO_CLEAR_SCAM, true)

        // Always permit WhatsApp, SMS, and known shopping/food apps if autoClearPromos or autoClearScam is active,
        // ensuring promotional and scam clutter from messaging and commerce apps is actively caught and cleared!
        if ((autoClearPromos || autoClearScam) && (WHATSAPP_PACKAGES.contains(normalizedPkg) ||
                    normalizedPkg.startsWith("com.whatsapp") ||
                    isSmsPackage(normalizedPkg, applicationContext) ||
                    ECOMMERCE_AND_FOOD_PACKAGES.contains(normalizedPkg))) {
            return true
        }

        val configJson = prefs.getString(PREF_FILTER_CONFIG, null)
        if (configJson == null) {
            // Default Blacklist Mode: Block known system noise
            return !DEFAULT_SYSTEM_BLACKLIST.contains(normalizedPkg)
        }

        return try {
            val json = JSONObject(configJson)
            val mode = json.optString("mode", "blacklist")
            val packagesArray = json.optJSONArray("packages")
                ?: json.optJSONArray(if (mode.equals("whitelist", ignoreCase = true)) "whitelistedPackages" else "blacklistedPackages")
                ?: JSONArray()
            val packageSet = mutableSetOf<String>()
            for (i in 0 until packagesArray.length()) {
                packageSet.add(packagesArray.getString(i).trim().lowercase())
            }

            if (mode.equals("whitelist", ignoreCase = true)) {
                packageSet.contains(normalizedPkg)
            } else {
                !packageSet.contains(normalizedPkg) && !DEFAULT_SYSTEM_BLACKLIST.contains(normalizedPkg)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error evaluating package filter config; falling back to blacklist", e)
            !DEFAULT_SYSTEM_BLACKLIST.contains(normalizedPkg)
        }
    }

    private fun recordQuarantine(prefs: SharedPreferences) {
        synchronized(QUEUE_LOCK) {
            val current = prefs.getInt(PREF_QUARANTINE_COUNT, 0)
            prefs.edit()
                .putInt(PREF_QUARANTINE_COUNT, current + 1)
                .putLong(PREF_LAST_QUARANTINED_AT, System.currentTimeMillis())
                .apply()
        }
    }

    private fun enqueuePendingNotification(prefs: SharedPreferences, item: JSONObject) {
        synchronized(QUEUE_LOCK) {
            try {
                val existing = prefs.getString(PREF_PENDING_NOTIFICATIONS, "[]") ?: "[]"
                val array = try {
                    JSONArray(existing)
                } catch (_: Exception) {
                    JSONArray()
                }

                // Append new notification
                array.put(item)

                // FIFO Eviction if over MAX_QUEUE_SIZE
                val trimmedArray = if (array.length() > MAX_QUEUE_SIZE) {
                    val newArr = JSONArray()
                    val startIndex = array.length() - MAX_QUEUE_SIZE
                    for (i in startIndex until array.length()) {
                        newArr.put(array.getJSONObject(i))
                    }
                    newArr
                } else {
                    array
                }

                prefs.edit().putString(PREF_PENDING_NOTIFICATIONS, trimmedArray.toString()).apply()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to enqueue pending notification to SharedPreferences", e)
            }
        }
    }

    companion object {
        const val TAG = "RemySensory"
        const val PREFS_NAME = "remy_sensory_prefs"
        const val PREF_PENDING_NOTIFICATIONS = "remy_pending_notifications"
        const val PREF_FILTER_CONFIG = "remy_filter_config"
        const val PREF_QUARANTINE_COUNT = "remy_quarantine_count"
        const val PREF_LAST_QUARANTINED_AT = "remy_last_quarantined_at"
        const val PREF_AUTO_CLEAR_PROMOS = "remy_auto_clear_promos"
        const val PREF_AUTO_SNOOZE_NOISE = "remy_auto_snooze_noise"
        const val PREF_AUTO_CLEAR_SCAM = "remy_auto_clear_scam"
        const val MAX_QUEUE_SIZE = 100

        @Volatile
        var isConnected: Boolean = false

        @Volatile
        var instance: RemyNotificationListenerService? = null

        val QUEUE_LOCK = Any()

        val DEFAULT_SYSTEM_BLACKLIST = setOf(
            "android",
            "com.android.systemui",
            "com.google.android.gms",
            "com.android.vending",
            "com.android.providers.downloads",
            "com.google.android.inputmethod.latin",
            "com.samsung.android.honeyboard",
            "com.sec.android.app.launcher",
            "com.google.android.apps.nexuslauncher",
            "com.android.settings",
            "com.google.android.deskclock",
            "com.sec.android.app.clockpackage"
        )

        val WHATSAPP_PACKAGES = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b"
        )

        val SMS_PACKAGES = setOf(
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            "com.android.mms",
            "com.motorola.messaging",
            "com.oneplus.mms",
            "com.sonyericsson.conversations",
            "com.sonymobile.conversations",
            "com.truecaller",
            "com.xiaomi.mms",
            "com.miui.mms",
            "com.coloros.mms",
            "com.oppo.mms",
            "com.vivo.mms",
            "com.transsion.mms",
            "com.huawei.message"
        )

        val ECOMMERCE_AND_FOOD_PACKAGES = setOf(
            "com.swiggy.android",
            "com.application.zomato",
            "in.amazon.mShop.android.shopping",
            "com.amazon.mShop.android.shopping",
            "com.flipkart.android",
            "com.myntra.android",
            "com.ubercab",
            "com.olacabs.customer",
            "com.dominospizza",
            "com.mcdonalds.app",
            "com.makemytrip",
            "com.blinkit.app",
            "com.zeptonow.android",
            "com.dunzo.user",
            "com.bigbasket.mobileapp",
            "com.tatadigital.tcp",
            "com.meesho.supply",
            "com.ajio.shop",
            "com.nykaa"
        )

        private val TRANSACTIONAL_OR_ACTIONABLE_REGEX = Regex(
            """\b(out for delivery|arriving today|arriving tomorrow|will be delivered|package arriving|driver is on the way|on the way to your address|courier out for delivery|dispatched|in transit|order shipped|package has shipped|package shipped|delivery attempt|ready for pickup|pickup ready|parcel ready|handed directly|order confirmed|order placed|preparing your order|order is being prepared|driver has arrived|cab is waiting|otp|verification code|verify code|bill due|payment due|emi due|web check-in|boarding pass|gate closes|flight departs|train departs)\b""",
            RegexOption.IGNORE_CASE
        )

        private val BANK_TRANSACTION_REGEX = Regex(
            """\b(?:debited (?:for|by|from|with)|credited (?:to|with)|a/c\s*(?:no\.?)?\s*[\w*xX]+\s*(?:is\s*)?(?:debited|credited)|acct\s*(?:is\s*)?(?:debited|credited)|(?:inr|rs\.?|₹|\$)\s*[\d,]+(?:\.\d{2})?\s*(?:debited|credited)|avail(?:able)?\s*bal(?:ance)?|closing\s*bal(?:ance)?|clear\s*bal(?:ance)?|upi\s*(?:ref|txn|transaction)|spent\s*on\s*(?:credit|debit)?\s*card|atm\s*withdrawn?|pos\s*txn|card\s*ending\s*(?:in\s*)?[\d*xX]{4})\b""",
            RegexOption.IGNORE_CASE
        )

        private val LOTTERY_SCAM_REGEX = Regex(
            """\b(?:congratulations|congrats|hurry|lucky winner|dear winner|selected)\b.*(?:won|winner|winning|selected for|claim your)\b.*(?:lottery|jackpot|lucky draw|bumper prize|cash prize|reward prize|kbc|car prize|crore|lakhs?|fortune|award)|\b(?:won|winner of|claim)\s+(?:a\s+)?(?:lottery|jackpot|bumper prize|lucky draw|kbc prize|cash reward|free gift)\b|\b(?:you have won|you won)\s+(?:a\s+)?(?:lottery|jackpot|lucky draw|bumper prize|cash prize|cash reward|reward|prize money|fortune|crore|lakhs?|free\s+(?:iphone|car|bike|cash))\b|\bwon a lucky draw\b|\b(?:kbc|kaun banega crorepati)\b.*(?:lottery|prize|winner|number|head office)|\bclaim your (?:lottery|jackpot|prize money|winnings|free car)\b|\b(?:selected\s+for|win\s+a)\s+(?:free\s+)?(?:iphone|car|bike|tata safari|cash)\b.*(?:click|call|claim)""",
            RegexOption.IGNORE_CASE
        )

        private val FAKE_KYC_SUSPENSION_REGEX = Regex(
            """\b(?:pan(?: card)?|aadhaar(?: card)?|kyc|(?:bank\s+)?(?:account|a/c|acct)|sim(?: card)?|netbanking|yono|debit card|credit card)\b.*(?:suspended|blocked|deactivated|expired|restricted|freeze|inactive|terminated)\b.*(?:click|visit|update|verify|call|link|apk|contact)|\b(?:dear (?:customer|user)|urgent:?|notice:?)\b.*(?:pan card|kyc|aadhaar)\b.*(?:suspended|blocked|deactivated|expire|invalid|terminated)|\b(?:update|complete|verify)\s+(?:your\s+)?(?:kyc|pan card|aadhaar)\s+(?:immediately|urgently|today|within \d+ hours?)\s+(?:or|otherwise)\s+(?:your\s+)?(?:account|a/c|acct|sim|card|services?)\s+(?:will be|is)\s+(?:blocked|suspended|deactivated|closed)|\be[- ]?kyc\s+(?:pending|expired|verification required|suspended)\b|\b(?:yono|sbi|hdfc|icici|axis|pnb|paytm|airtel)\s+(?:account|a/c|acct|rewards?)\b.*(?:blocked|suspended|update kyc|redeem points.*(?:link|http|bit\.ly))|\byour\s+(?:sbi|hdfc|icici|axis|bank)\s+(?:account|a/c|acct)\s+(?:has been|is)\s+(?:suspended|blocked)\b""",
            RegexOption.IGNORE_CASE
        )

        private val DISCONNECTION_THREAT_REGEX = Regex(
            """\b(?:electricity|power|light)\s+(?:power\s+)?(?:will be|to be)\s+(?:disconnect(?:ed)?|cut(?: off)?)\s+(?:tonight|today|by \d+[:.]\d+|\d+\s*(?:pm|am))\b|\b(?:previous|last)\s+month\s+bill\s+not\s+updated.*(?:disconnect|officer|call)|\belectricity (?:officer|helpline|department)\b.*(?:\d{10}|\+91\d{10})|\bpower (?:supply )?(?:will be )?disconnected\b|\belectricity bill\b.*(?:disconnected tonight|contact power officer|call electricity officer)""",
            RegexOption.IGNORE_CASE
        )

        private val LOAN_TRAP_REGEX = Regex(
            """\b(?:pre[- ]approved|instant)\s+(?:personal\s+)?loan\s+of\s+(?:₹|rs\.?|inr)?\s*[\d,]+\s*(?:approved|disbursed|credited|waiting|ready)\b.*(?:no\s+(?:cibil|documents?|doc|verification|income proof)|without documents?|apply now|click|link)|\b(?:approved\s+loan|claim\s+your\s+loan|get\s+instant\s+cash\s+loan)\b.*(?:no cibil|0% interest|no income proof|click|bit\.ly)|\bcredit card\b.*(?:limit of\s+(?:₹|rs\.?|inr)?\s*[\d,]+).*(?:pre[- ]approved|free|without (?:income proof|documents?)|no annual fee|apply now.*(?:bit\.ly|link|click))|\b(?:instant\s+loan\s+in\s+\d+\s+(?:mins?|minutes?)|paperless\s+loan|loan\s+disbursal\s+pending)\b.*(?:click|apply|link)|\b(?:bad cibil|low cibil)\s+loan\s+approved\b""",
            RegexOption.IGNORE_CASE
        )

        private val SUSPICIOUS_APK_LINK_REGEX = Regex(
            """\b(?:download|install|update)\b.*\.apk\b|\b(?:whatsapp\s+pink|payment\s+app\s+update|kyc\s+app)\b.*\.apk|\b(?:bit\.ly|tinyurl\.com|is\.gd|cutt\.ly|t\.co|rb\.gy|shorturl\.at|tiny\.cc|cutt\.us|surl\.li)\b.*(?:apk|kyc|pan|winner|loan|claim|bonus|suspend|reward|gift|free|earn|job)|\b(?:apk download|install apk)\b""",
            RegexOption.IGNORE_CASE
        )

        private val CRYPTO_JOB_SCAM_REGEX = Regex(
            """\b(?:earn|make)\s+(?:₹|rs\.?|inr|\$)?\s*[\d,]+(?:\s*-\s*(?:₹|rs\.?|inr|\$)?\s*[\d,]+)?\s*(?:daily|per day|every day)\s*(?:working from home|work from home|from home|online|part[- ]time)\b|\b(?:part[- ]time\s+job|work(?:ing)?\s+from\s+home)\b.*(?:liking\s+(?:youtube|videos?)|rating\s+(?:hotels?|apps?)|google\s+maps|reviews?).*(?:telegram|whatsapp|\+91|\d{10})|\b(?:guaranteed|assured)\s+(?:returns?|profit)\s+of\s+\d+%\b|\b(?:double\s+your\s+money|multiply\s+investment)\s+in\s+\d+\s+(?:days?|hours?|weeks?)\b|\b(?:crypto\s+mining|bitcoin\s+investment|forex\s+trading\s+signals?)\b.*(?:guaranteed|daily profit|join telegram|telegram channel)|\b(?:work(?:ing)?\s+from\s+home|part[- ]time\s+job)\s+offer.*(?:daily payout|earn up to \d+)""",
            RegexOption.IGNORE_CASE
        )

        private val GAMBLING_SPAM_REGEX = Regex(
            """\b(?:play\s+online\s+(?:rummy|casino|teen patti|poker)|bet\s+on\s+(?:ipl|cricket|casino))\b.*(?:deposit\s+(?:₹|rs\.?|inr)?\s*\d+|get\s+(?:₹|rs\.?|inr)?\s*\d+\s+free|bonus|bonus\s+code)|\b(?:claim\s+100%\s+deposit\s+bonus|register\s+and\s+get\s+(?:₹|rs\.?|inr)?\s*\d+\s+cash)\b""",
            RegexOption.IGNORE_CASE
        )

        private val TELEMARKETING_SPAM_REGEX = Regex(
            """\b(?:exclusive\s+plots?|villa\s+plots?|luxury\s+villas?|open\s+plots?)\s+(?:near|at|in)\b.*(?:starting\s+(?:at\s+)?(?:₹|rs\.?|inr)?\s*[\d.]+\s*(?:lakhs?|cr)|call\s+now|book\s+site\s+visit)|\b(?:escorts?|call\s+girls?|massage\s+service)\b.*(?:\d{10}|\+91)|\b(?:free\s+stock\s+tips?|sure\s+shot\s+calls?|jackpot\s+calls?|nifty\s+calls?|banknifty\s+calls?|multibagger\s+stocks?)\b.*(?:join\s+telegram|call\s+now|whatsapp)""",
            RegexOption.IGNORE_CASE
        )

        private val PROMOTIONAL_OFFER_REGEX = Regex(
            """\b(\d{1,3}%\s*(?:off|discount|cashback)|flat\s*(?:₹|rs\.?|inr|\$)?\s*\d+\s*(?:off|discount|cashback)?|save\s*(?:₹|rs\.?|inr|\$)?\s*\d+|(?:₹|rs\.?|inr|\$)\s*\d+\s*(?:off|discount|cashback)|use\s+code\b|coupons?\b|promo\s+codes?|vouchers?\b|discounts?\b|special\s+offers?|exclusive\s+offers?|limited\s+period\s+offers?|flash\s+sales?|mega\s+sales?|sales?\s+is\s+live|free\s+delivery|free\s+shipping|bogo\b|buy\s+1\s+get\s+1|cashbacks?\b|hurry\b.*(?:offers?|deals?|discounts?|sales?)|deals?\s+of\s+the\s+day|flat\s+discounts?|festive\s+offers?|extra\s+\d+%\s*off|claim\s+(?:your\s+)?offers?|claim\s+(?:your\s+)?rewards?|avail\s+(?:this\s+)?offers?|shop\s+now|order\s+now|explore\s+deals?|rewards?\b|win\s+(?:₹|rs\.?|inr|\$)?\s*\d+)\b""",
            RegexOption.IGNORE_CASE
        )

        private val GENERIC_PROMO_KEYWORDS = Regex(
            """\b(offers?|deals?|discounts?|sales?|cashbacks?|vouchers?|coupons?|promos?|promotions?|promotional|savings?|save\s*\d+)\b""",
            RegexOption.IGNORE_CASE
        )

        private val NOISE_REGEX = Regex(
            """\b(started following you|liked your|commented on|tagged you|shared a (?:photo|video|post)|trending on|apps? updated successfully|sync complete|download complete|battery (?:fully charged|full|low)|rate your (?:order|ride|experience|driver)|how was your)\b""",
            RegexOption.IGNORE_CASE
        )

        fun isSmsPackage(pkg: String, context: Context): Boolean {
            val normalized = pkg.trim().lowercase()
            if (SMS_PACKAGES.contains(normalized)) return true
            if (normalized.contains("messaging") ||
                normalized.contains(".mms") ||
                normalized.contains("telephony") ||
                normalized.contains("truecaller") ||
                normalized.contains("conversations") ||
                normalized.contains("message") ||
                normalized.contains("sms")
            ) return true
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    val defaultSms = Telephony.Sms.getDefaultSmsPackage(context)
                    defaultSms != null && defaultSms.equals(pkg, ignoreCase = true)
                } else {
                    false
                }
            } catch (e: Exception) {
                false
            }
        }

        fun isBankTransaction(title: String, text: String): Boolean {
            val combined = "$title $text"
            return BANK_TRANSACTION_REGEX.containsMatchIn(combined)
        }

        fun isActionableOrTransactional(title: String, text: String): Boolean {
            val combined = "$title $text"
            return TRANSACTIONAL_OR_ACTIONABLE_REGEX.containsMatchIn(combined) || isBankTransaction(title, text)
        }

        fun isScamNotification(pkg: String, title: String, text: String, context: Context): Boolean {
            val combined = "$title $text"
            if (combined.isBlank()) return false
            if (SensorySecurityFilter.isSensitiveAuth(title, text)) return false

            // Genuine bank transaction receipts are safe UNLESS they contain account suspension / APK phishing threats
            if (isBankTransaction(title, text)) {
                val hasKycThreat = FAKE_KYC_SUSPENSION_REGEX.containsMatchIn(combined)
                val hasApkThreat = SUSPICIOUS_APK_LINK_REGEX.containsMatchIn(combined)
                if (!hasKycThreat && !hasApkThreat) {
                    return false
                }
            }

            // Genuine deliveries or utility bills are safe UNLESS they contain scam threats (phishing APK, lottery, loan trap, fake KYC)
            if (TRANSACTIONAL_OR_ACTIONABLE_REGEX.containsMatchIn(combined)) {
                val isDisconnectionScam = DISCONNECTION_THREAT_REGEX.containsMatchIn(combined)
                val isFakeKyc = FAKE_KYC_SUSPENSION_REGEX.containsMatchIn(combined)
                val isLottery = LOTTERY_SCAM_REGEX.containsMatchIn(combined)
                val isLoanTrap = LOAN_TRAP_REGEX.containsMatchIn(combined)
                val isApkOrLink = SUSPICIOUS_APK_LINK_REGEX.containsMatchIn(combined)
                val isCryptoJob = CRYPTO_JOB_SCAM_REGEX.containsMatchIn(combined)
                val isGambling = GAMBLING_SPAM_REGEX.containsMatchIn(combined)
                val isTelemarketing = TELEMARKETING_SPAM_REGEX.containsMatchIn(combined)

                return isDisconnectionScam || isFakeKyc || isLottery || isLoanTrap ||
                        isApkOrLink || isCryptoJob || isGambling || isTelemarketing
            }

            return LOTTERY_SCAM_REGEX.containsMatchIn(combined) ||
                    FAKE_KYC_SUSPENSION_REGEX.containsMatchIn(combined) ||
                    DISCONNECTION_THREAT_REGEX.containsMatchIn(combined) ||
                    LOAN_TRAP_REGEX.containsMatchIn(combined) ||
                    SUSPICIOUS_APK_LINK_REGEX.containsMatchIn(combined) ||
                    CRYPTO_JOB_SCAM_REGEX.containsMatchIn(combined) ||
                    GAMBLING_SPAM_REGEX.containsMatchIn(combined) ||
                    TELEMARKETING_SPAM_REGEX.containsMatchIn(combined)
        }

        fun isPromotionalNotification(pkg: String, title: String, text: String, context: Context): Boolean {
            val combined = "$title $text"
            if (combined.isBlank()) return false
            if (SensorySecurityFilter.isSensitiveAuth(title, text)) return false
            if (isActionableOrTransactional(title, text)) return false

            val isWhatsapp = WHATSAPP_PACKAGES.contains(pkg) || pkg.startsWith("com.whatsapp")
            val isSms = isSmsPackage(pkg, context)
            val isEcommerce = ECOMMERCE_AND_FOOD_PACKAGES.contains(pkg)

            if (isWhatsapp || isSms) {
                return PROMOTIONAL_OFFER_REGEX.containsMatchIn(combined) ||
                        (GENERIC_PROMO_KEYWORDS.containsMatchIn(combined) && !isActionableOrTransactional(title, text))
            }

            if (isEcommerce) {
                return PROMOTIONAL_OFFER_REGEX.containsMatchIn(combined) || GENERIC_PROMO_KEYWORDS.containsMatchIn(combined)
            }

            return PROMOTIONAL_OFFER_REGEX.containsMatchIn(combined)
        }

        fun isNoise(title: String, text: String): Boolean {
            val combined = "$title $text"
            return NOISE_REGEX.containsMatchIn(combined)
        }

        fun tryMarkAsRead(notification: Notification, context: Context): Boolean {
            val actions = mutableListOf<Notification.Action>()
            notification.actions?.let { actions.addAll(it) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
                try {
                    val wearableExtender = Notification.WearableExtender(notification)
                    actions.addAll(wearableExtender.actions)
                } catch (_: Exception) {
                }
            }
            if (actions.isEmpty()) return false

            for (action in actions) {
                val isSemanticMarkRead = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    action.semanticAction == Notification.Action.SEMANTIC_ACTION_MARK_AS_READ
                } else false

                val titleStr = action.title?.toString()?.trim() ?: ""
                if (titleStr.contains("unread", ignoreCase = true)) continue

                val isTitleMarkRead = titleStr.equals("read", ignoreCase = true) ||
                        titleStr.equals("mark as read", ignoreCase = true) ||
                        titleStr.equals("mark read", ignoreCase = true) ||
                        titleStr.equals("mark as seen", ignoreCase = true) ||
                        titleStr.equals("seen", ignoreCase = true) ||
                        Regex("""\b(?:mark\s+(?:all\s+)?(?:as\s+)?(?:read|seen)|read|seen)\b""", RegexOption.IGNORE_CASE).containsMatchIn(titleStr) ||
                        Regex("""\b(?:leído|marcar\s+como\s+leído|lu|marquer\s+comme\s+lu|gelesen|als\s+gelesen\s+markieren|letto|lido|marcar\s+como\s+lida)\b""", RegexOption.IGNORE_CASE).containsMatchIn(titleStr)

                if (isSemanticMarkRead || isTitleMarkRead) {
                    return try {
                        action.actionIntent?.send()
                        Log.i(TAG, "Successfully invoked mark-as-read PendingIntent for action: $titleStr")
                        true
                    } catch (e: Exception) {
                        try {
                            action.actionIntent?.send(context, 0, null)
                            Log.i(TAG, "Successfully invoked mark-as-read PendingIntent (with context) for action: $titleStr")
                            true
                        } catch (e2: Exception) {
                            Log.e(TAG, "Failed to invoke mark-as-read action: $titleStr", e2)
                            false
                        }
                    }
                }
            }
            return false
        }

        /**
         * Dismisses a specific status bar notification by its key.
         */
        fun dismissNotification(key: String): Boolean {
            if (key.isBlank()) return false
            val service = instance
            if (service == null) {
                Log.w(TAG, "Cannot dismiss notification ($key): listener service is not connected")
                return false
            }
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    service.cancelNotification(key)
                }
                Log.i(TAG, "Dismissed notification from status bar: $key")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to dismiss notification ($key)", e)
                false
            }
        }

        /**
         * Marks an active notification as read in the underlying app and dismisses it from tray.
         */
        fun markNotificationAsRead(key: String): Boolean {
            if (key.isBlank()) return false
            val service = instance ?: return false
            return try {
                val sbn = service.activeNotifications?.firstOrNull { it.key == key }
                if (sbn != null) {
                    val marked = tryMarkAsRead(sbn.notification, service.applicationContext)
                    service.cancelNotification(key)
                    Log.i(TAG, "markNotificationAsRead executed for key=$key (marked=$marked)")
                    true
                } else {
                    service.cancelNotification(key)
                    Log.i(TAG, "markNotificationAsRead: Key fallback cancelled for key=$key")
                    true
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to mark notification as read ($key)", e)
                false
            }
        }

        /**
         * Sweeps active notifications and applies autoClearPromos & autoSnoozeNoise.
         */
        fun processActiveNotifications() {
            val service = instance ?: return
            try {
                val activeSbns = service.activeNotifications ?: return
                val prefs = service.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val autoClearPromos = prefs.getBoolean(PREF_AUTO_CLEAR_PROMOS, true)
                val autoSnoozeNoise = prefs.getBoolean(PREF_AUTO_SNOOZE_NOISE, false)
                val autoClearScam = prefs.getBoolean(PREF_AUTO_CLEAR_SCAM, true)

                for (sbn in activeSbns) {
                    val pkg = sbn.packageName ?: continue
                    if (pkg == service.applicationContext.packageName) continue
                    val notification = sbn.notification ?: continue
                    val flags = notification.flags
                    val isOngoing = (flags and Notification.FLAG_ONGOING_EVENT) != 0
                    if (isOngoing) continue

                    val extras = notification.extras
                    var title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
                    if (title.isEmpty()) {
                        title = extras?.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString()?.trim() ?: ""
                    }
                    var text = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
                    if (text.isNullOrEmpty()) {
                        text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""
                    }
                    if (text.isEmpty()) {
                        val lines = extras?.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
                        if (!lines.isNullOrEmpty()) {
                            text = lines.filterNotNull().joinToString(" ") { it.toString().trim() }
                        }
                    }
                    val subText = extras?.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim()
                    if (!subText.isNullOrEmpty()) {
                        text = if (text.isEmpty()) subText else "$text $subText"
                    }

                    if (SensorySecurityFilter.isSensitiveAuth(title, text)) continue

                    val isWhatsapp = WHATSAPP_PACKAGES.contains(pkg) || pkg.startsWith("com.whatsapp")
                    val isSms = isSmsPackage(pkg, service.applicationContext)
                    val isScam = isScamNotification(pkg, title, text, service.applicationContext)
                    val isPromo = isPromotionalNotification(pkg, title, text, service.applicationContext)

                    if (isScam) {
                        if (isWhatsapp || isSms) {
                            tryMarkAsRead(notification, service.applicationContext)
                        }
                        if (autoClearScam) {
                            if (sbn.key != null) {
                                service.cancelNotification(sbn.key)
                            } else {
                                @Suppress("DEPRECATION")
                                service.cancelNotification(pkg, sbn.tag, sbn.id)
                            }
                            Log.i(TAG, "processActive: Marked read & dismissed scam notification: $pkg (${sbn.key})")
                        }
                    } else if (isPromo) {
                        if (isWhatsapp || isSms) {
                            tryMarkAsRead(notification, service.applicationContext)
                            if (autoClearPromos) {
                                if (sbn.key != null) {
                                    service.cancelNotification(sbn.key)
                                } else {
                                    @Suppress("DEPRECATION")
                                    service.cancelNotification(pkg, sbn.tag, sbn.id)
                                }
                                Log.i(TAG, "processActive: Marked read & dismissed promo msg: $pkg (${sbn.key})")
                            }
                        } else if (autoClearPromos) {
                            if (sbn.key != null) {
                                service.cancelNotification(sbn.key)
                            } else {
                                @Suppress("DEPRECATION")
                                service.cancelNotification(pkg, sbn.tag, sbn.id)
                            }
                            Log.i(TAG, "processActive: Dismissed promo from tray: $pkg (${sbn.key})")
                        }
                    } else if (isNoise(title, text) && autoSnoozeNoise) {
                        if (sbn.key != null) {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                service.snoozeNotification(sbn.key, 3600000L)
                                Log.i(TAG, "processActive: Snoozed noise notification from tray: $pkg (${sbn.key})")
                            } else {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                    service.cancelNotification(sbn.key)
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to process active notifications", e)
            }
        }

        /**
         * Snoozes a specific status bar notification by its key for the given duration in ms.
         * Falls back to cancellation on API < 26.
         */
        fun snoozeNotification(key: String, durationMs: Long): Boolean {
            if (key.isBlank()) return false
            val service = instance
            if (service == null) {
                Log.w(TAG, "Cannot snooze notification ($key): listener service is not connected")
                return false
            }
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    service.snoozeNotification(key, durationMs)
                    Log.i(TAG, "Snoozed notification $key for ${durationMs}ms")
                    true
                } else {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        service.cancelNotification(key)
                    }
                    Log.i(TAG, "Snooze fallback (cancel) for notification: $key")
                    true
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to snooze notification ($key)", e)
                false
            }
        }

        /**
         * Clears all dismissible notifications from the status bar tray.
         */
        fun dismissAllNotifications(): Boolean {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Cannot dismiss all notifications: listener service is not connected")
                return false
            }
            return try {
                service.cancelAllNotifications()
                Log.i(TAG, "Dismissed all notifications from status bar")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to dismiss all notifications", e)
                false
            }
        }

        /**
         * Returns active status bar notification keys.
         */
        fun getActiveNotificationKeys(): List<String> {
            val service = instance ?: return emptyList()
            return try {
                service.activeNotifications?.mapNotNull { it.key } ?: emptyList()
            } catch (e: Exception) {
                emptyList()
            }
        }
    }
}
