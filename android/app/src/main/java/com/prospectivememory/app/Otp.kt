package com.prospectivememory.app

object Otp {
    private val hint = Regex(
        """\b(otp|one[\s-]?time(?:\s+pass(?:word|code))?|verification code|verification pin|auth(?:entication)? code|security code)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val isolated = Regex("""(?<!\d)(\d{4,8})(?!\d)""")
    private val years = setOf("2024", "2025", "2026", "2027", "2028", "2029", "2030")

    fun looksLike(text: String): Boolean = hint.containsMatchIn(text)

    fun extract(text: String): String? {
        if (text.isBlank() || !looksLike(text)) return null
        val codes = isolated.findAll(text).map { it.groupValues[1] }.filter { it !in years }.toList()
        if (codes.isEmpty()) return null
        return codes.firstOrNull { it.length == 6 } ?: codes.first()
    }

    fun redact(text: String, code: String?): String {
        if (code.isNullOrBlank()) return text
        return text.replace(code, "******")
    }
}
