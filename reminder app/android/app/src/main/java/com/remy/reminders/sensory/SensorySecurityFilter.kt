package com.remy.reminders.sensory

/**
 * High-performance, zero-latency on-device security filter.
 * Evaluates notifications at the native OS boundary to quarantine sensitive
 * authentication tokens, OTPs, passwords, and banking verification codes
 * before they can be buffered or emitted to the JavaScript runtime.
 */
object SensorySecurityFilter {

    private val OTP_KEYWORD_REGEX = Regex(
        """\b(otp|one[- ]time[- ]password|one[- ]time[- ]pin|verification code|verify code|security code|login code|passcode|secret pin|auth code|authorization code|authorisation code|temporary password|temp password|netbanking password|atm pin|cvv|password reset code)\b""",
        RegexOption.IGNORE_CASE
    )

    private val BANKING_OTP_PHRASES = Regex(
        """\b(is your otp|is the otp|otp for|txn of|purchase of|payment of|valid for \d+ (?:mins?|minutes?|secs?|seconds?)|never share|do not share (?:this|your)? (?:code|otp|password|pin)|secret code|never disclose)\b""",
        RegexOption.IGNORE_CASE
    )

    private val VERIFICATION_CODE_REGEX = Regex("""\b[0-9]{4,8}\b""")

    /**
     * Determines whether the notification text contains sensitive credentials.
     * @param title Notification title
     * @param text Notification body / big text
     * @return true if the notification is quarantined as sensitive authentication; false otherwise.
     */
    fun isSensitiveAuth(title: String, text: String): Boolean {
        if (title.isEmpty() && text.isEmpty()) return false
        val combined = "$title $text"

        // Check for explicit OTP keywords or banking verification phrases
        val hasKeyword = OTP_KEYWORD_REGEX.containsMatchIn(combined)
        val hasBankingPhrase = BANKING_OTP_PHRASES.containsMatchIn(combined)

        if (!hasKeyword && !hasBankingPhrase) {
            return false
        }

        // If keywords or banking phrases exist, check for presence of numeric codes or security warnings
        val hasNumericCode = VERIFICATION_CODE_REGEX.containsMatchIn(combined)
        val hasExplicitSecurityWarning = combined.contains("do not share", ignoreCase = true) ||
                combined.contains("never share", ignoreCase = true) ||
                combined.contains("never disclose", ignoreCase = true) ||
                combined.contains("cvv", ignoreCase = true) ||
                combined.contains("pin", ignoreCase = true)

        return hasNumericCode || hasExplicitSecurityWarning
    }
}
