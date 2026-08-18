package com.prospectivememory.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class GlyphDef(
    val id: String,
    val label: String,
    val category: String,
    val hint: String,
    val templates: List<List<Unistroke.Pt>>,
)

object GlyphStore {
    const val HIGH = 0.78f
    const val LOW = 0.58f

    val DEFAULTS = listOf(
        Triple("task", "Task", "•  tap / tiny mark"),
        Triple("event", "Event", "○  circle"),
        Triple("note", "Note", "—  dash"),
        Triple("expand", "Expand later", "↗  diagonal up"),
        Triple("finance", "Money", "S  rupee/bill"),
        Triple("urgent", "Urgent", "!  vertical"),
    )

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("pmem_glyphs", Context.MODE_PRIVATE)

    fun onboarded(ctx: Context) = prefs(ctx).getBoolean("onboarded", false)

    fun setOnboarded(ctx: Context, v: Boolean) {
        prefs(ctx).edit().putBoolean("onboarded", v).apply()
    }

    fun load(ctx: Context): List<GlyphDef> {
        val raw = prefs(ctx).getString("defs", null)
        if (raw.isNullOrBlank()) return seed()
        return try {
            parse(raw)
        } catch (_: Exception) {
            seed()
        }
    }

    fun save(ctx: Context, defs: List<GlyphDef>) {
        prefs(ctx).edit().putString("defs", serialize(defs)).apply()
    }

    fun templatesMap(ctx: Context): Map<String, List<List<Unistroke.Pt>>> {
        val defs = load(ctx)
        return defs.associate { d ->
            val samples = if (d.templates.isEmpty()) listOf(Unistroke.synthetic(d.id)) else d.templates
            d.id to samples
        }
    }

    fun addSample(ctx: Context, id: String, points: List<Unistroke.Pt>) {
        val norm = Unistroke.normalize(points)
        val defs = load(ctx).toMutableList()
        val i = defs.indexOfFirst { it.id == id }
        if (i < 0) return
        val cur = defs[i]
        defs[i] = cur.copy(templates = cur.templates + listOf(norm))
        save(ctx, defs)
    }

    fun conflictScore(candidate: List<Unistroke.Pt>, others: Map<String, List<List<Unistroke.Pt>>>, selfId: String): Pair<String, Float>? {
        val rest = others.filterKeys { it != selfId }
        val m = Unistroke.recognize(candidate, rest) ?: return null
        return m.id to m.score
    }

    private fun seed(): List<GlyphDef> = DEFAULTS.map { (id, label, hint) ->
        GlyphDef(id, label, id, hint, listOf(Unistroke.synthetic(id)))
    }

    private fun serialize(defs: List<GlyphDef>): String {
        val arr = JSONArray()
        defs.forEach { d ->
            val o = JSONObject()
            o.put("id", d.id)
            o.put("label", d.label)
            o.put("category", d.category)
            o.put("hint", d.hint)
            val tpls = JSONArray()
            d.templates.forEach { stroke ->
                val s = JSONArray()
                stroke.forEach { p ->
                    s.put(JSONObject().put("x", p.x.toDouble()).put("y", p.y.toDouble()))
                }
                tpls.put(s)
            }
            o.put("templates", tpls)
            arr.put(o)
        }
        return arr.toString()
    }

    private fun parse(raw: String): List<GlyphDef> {
        val arr = JSONArray(raw)
        val out = ArrayList<GlyphDef>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val tpls = ArrayList<List<Unistroke.Pt>>()
            val ta = o.optJSONArray("templates") ?: JSONArray()
            for (t in 0 until ta.length()) {
                val s = ta.getJSONArray(t)
                val pts = ArrayList<Unistroke.Pt>()
                for (p in 0 until s.length()) {
                    val pt = s.getJSONObject(p)
                    pts.add(Unistroke.Pt(pt.getDouble("x").toFloat(), pt.getDouble("y").toFloat()))
                }
                if (pts.size >= 2) tpls.add(pts)
            }
            out.add(
                GlyphDef(
                    id = o.getString("id"),
                    label = o.getString("label"),
                    category = o.optString("category", o.getString("id")),
                    hint = o.optString("hint"),
                    templates = tpls,
                ),
            )
        }
        return out
    }
}
