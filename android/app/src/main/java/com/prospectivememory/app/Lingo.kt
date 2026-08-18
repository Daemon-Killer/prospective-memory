package com.prospectivememory.app

/**
 * Fast-capture shorthand.
 *
 * Table lines:
 *   d=dahi lena
 *   d|dahi=dahi lena          aliases
 *   c=call $                  $ = rest of the line
 *   buy=buy $
 *   pay bill=pay electricity bill
 *
 * Match: longest key at the start of the input (case-insensitive).
 * If no exact key, unique prefix of a key still expands (da → dahi).
 */
object Lingo {
    data class Expansion(
        val input: String,
        val output: String,
        val key: String?,
        val changed: Boolean,
    )

    fun parse(table: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        table.lineSequence().forEach { line ->
            val t = line.trim()
            if (t.isEmpty() || t.startsWith("#")) return@forEach
            val eq = t.indexOf('=')
            if (eq <= 0) return@forEach
            val lhs = t.substring(0, eq).trim().lowercase()
            val rhs = t.substring(eq + 1).trim()
            if (lhs.isEmpty() || rhs.isEmpty()) return@forEach
            lhs.split('|').map { it.trim() }.filter { it.isNotEmpty() }.forEach { alias ->
                out[alias] = rhs
            }
        }
        return out
    }

    fun expand(raw: String, table: String): String = resolve(raw, table).output

    fun resolve(raw: String, table: String): Expansion {
        val text = raw.trim()
        if (text.isEmpty()) return Expansion(text, text, null, false)
        val map = parse(table)
        if (map.isEmpty()) return Expansion(text, text, null, false)

        val hit = matchKey(text, map.keys) ?: return Expansion(text, text, null, false)
        val rest = text.substring(hit.length).trim()
        val template = map.getValue(hit)
        val output = applyTemplate(template, rest)
        return Expansion(text, output, hit, output != text)
    }

    fun suggestions(prefix: String, table: String, limit: Int = 8): List<Pair<String, String>> {
        val map = parse(table)
        val p = prefix.trim().lowercase()
        if (p.isEmpty()) return map.entries.take(limit).map { it.key to it.value }
        return map.entries
            .filter { it.key.startsWith(p) || it.key == p }
            .sortedBy { it.key.length }
            .take(limit)
            .map { it.key to it.value }
    }

    fun chips(table: String, recent: List<String>, limit: Int = 10): List<Pair<String, String>> {
        val map = parse(table)
        val ordered = LinkedHashSet<String>()
        recent.forEach { if (map.containsKey(it)) ordered.add(it) }
        map.keys.forEach { ordered.add(it) }
        return ordered.take(limit).mapNotNull { k -> map[k]?.let { k to it } }
    }

    private fun matchKey(text: String, keys: Set<String>): String? {
        val lower = text.lowercase()
        val exact = keys
            .filter { lower == it || lower.startsWith("$it ") }
            .maxByOrNull { it.length }
        if (exact != null) return exact

        val token = lower.split(Regex("\\s+"), limit = 2).first()
        val prefixed = keys.filter { it.startsWith(token) }
        return prefixed.minByOrNull { it.length }?.takeIf { prefixed.size == 1 || prefixed.any { it == token } }
    }

    private fun applyTemplate(template: String, rest: String): String {
        return when {
            template.contains('$') -> {
                val filled = template.replace("$", rest)
                filled.replace(Regex("\\s+"), " ").trim()
            }
            rest.isEmpty() -> template
            else -> "$template $rest"
        }
    }
}
