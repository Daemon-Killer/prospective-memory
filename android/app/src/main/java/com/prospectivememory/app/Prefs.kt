package com.prospectivememory.app

import android.content.Context

object Prefs {
    private const val NAME = "pmem"

    private fun p(ctx: Context) = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun url(ctx: Context) = p(ctx).getString("url", "http://192.168.1.10:8790") ?: ""

    fun token(ctx: Context) = p(ctx).getString("token", "") ?: ""

    fun lingo(ctx: Context) = p(ctx).getString("lingo", DEFAULT_LINGO) ?: DEFAULT_LINGO

    fun recentKeys(ctx: Context): List<String> {
        val raw = p(ctx).getString("lingo_recent", "") ?: ""
        return raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }
    }

    fun touchKey(ctx: Context, key: String?) {
        if (key.isNullOrBlank()) return
        val next = (listOf(key) + recentKeys(ctx).filter { it != key }).take(12)
        p(ctx).edit().putString("lingo_recent", next.joinToString(",")).apply()
    }

    fun save(ctx: Context, url: String, token: String, lingo: String) {
        p(ctx).edit()
            .putString("url", url.trim())
            .putString("token", token.trim())
            .putString("lingo", lingo)
            .apply()
    }

    const val DEFAULT_LINGO = """# key=thought    aliases with |     $ = rest of line
d|dahi=dahi lena
dudh|milk=doodh lena
bij|bill=pay electricity bill
rent=pay rent
c|call=call $
w|wa=whatsapp $
buy=buy $
pay=pay $
home=@home
off=@office"""
}
