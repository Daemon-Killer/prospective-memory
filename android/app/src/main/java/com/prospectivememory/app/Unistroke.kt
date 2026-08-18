package com.prospectivememory.app

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * $1 Unistroke Recognizer (Wobbrock, Wilson, Li).
 * Geometric template match — no ML, personal templates, milliseconds.
 */
object Unistroke {
    data class Pt(val x: Float, val y: Float)

    data class Match(
        val id: String,
        val score: Float,
        val runnersUp: List<Pair<String, Float>>,
    )

    const val N = 64
    private const val SQUARE = 250f
    private const val HALF_DIAGONAL = 0.5f * 353.553f // 0.5 * sqrt(250^2+250^2)
    private const val ANGLE_RANGE = (Math.PI / 4).toFloat()
    private const val ANGLE_PREC = (Math.PI / 90).toFloat()
    private val PHI = (0.5 * (-1 + sqrt(5.0))).toFloat()

    fun pathLength(points: List<Pt>): Float {
        var d = 0f
        for (i in 1 until points.size) d += dist(points[i - 1], points[i])
        return d
    }

    fun resample(points: List<Pt>, n: Int = N): List<Pt> {
        if (points.size < 2) return points
        val interval = pathLength(points) / (n - 1)
        val out = ArrayList<Pt>(n)
        out.add(points.first())
        var d = 0f
        val buf = points.toMutableList()
        var i = 1
        while (i < buf.size && out.size < n) {
            val prev = buf[i - 1]
            val cur = buf[i]
            val step = dist(prev, cur)
            if (d + step >= interval && step > 0f) {
                val t = (interval - d) / step
                val nx = prev.x + t * (cur.x - prev.x)
                val ny = prev.y + t * (cur.y - prev.y)
                val q = Pt(nx, ny)
                out.add(q)
                buf.add(i, q)
                d = 0f
            } else {
                d += step
                i++
            }
        }
        while (out.size < n) out.add(buf.last())
        return out.take(n)
    }

    fun normalize(points: List<Pt>): List<Pt> {
        if (points.size < 2) return points
        var pts = resample(points)
        pts = rotateBy(pts, -indicativeAngle(pts))
        pts = scaleTo(pts, SQUARE)
        return translateTo(pts, Pt(0f, 0f))
    }

    fun recognize(points: List<Pt>, templates: Map<String, List<List<Pt>>>): Match? {
        if (points.size < 2 || templates.isEmpty()) return null
        val cand = normalize(points)
        var bestId: String? = null
        var best = Float.POSITIVE_INFINITY
        val scores = ArrayList<Pair<String, Float>>()
        for ((id, samples) in templates) {
            var local = Float.POSITIVE_INFINITY
            for (tpl in samples) {
                val d = distanceAtBestAngle(cand, tpl)
                if (d < local) local = d
            }
            scores.add(id to scoreOf(local))
            if (local < best) {
                best = local
                bestId = id
            }
        }
        val ranked = scores.sortedByDescending { it.second }
        val id = bestId ?: return null
        return Match(id, scoreOf(best), ranked.drop(1).take(3))
    }

    fun scoreOf(distance: Float): Float {
        val s = 1f - distance / HALF_DIAGONAL
        return s.coerceIn(0f, 1f)
    }

    private fun indicativeAngle(points: List<Pt>): Float {
        val c = centroid(points)
        return atan2(c.y - points[0].y, c.x - points[0].x)
    }

    private fun rotateBy(points: List<Pt>, radians: Float): List<Pt> {
        val c = centroid(points)
        val cos = cos(radians)
        val sin = sin(radians)
        return points.map { p ->
            Pt(
                (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
                (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
            )
        }
    }

    private fun scaleTo(points: List<Pt>, size: Float): List<Pt> {
        var minX = Float.POSITIVE_INFINITY
        var minY = Float.POSITIVE_INFINITY
        var maxX = Float.NEGATIVE_INFINITY
        var maxY = Float.NEGATIVE_INFINITY
        for (p in points) {
            if (p.x < minX) minX = p.x
            if (p.y < minY) minY = p.y
            if (p.x > maxX) maxX = p.x
            if (p.y > maxY) maxY = p.y
        }
        val w = (maxX - minX).coerceAtLeast(1f)
        val h = (maxY - minY).coerceAtLeast(1f)
        return points.map { Pt(it.x * (size / w), it.y * (size / h)) }
    }

    private fun translateTo(points: List<Pt>, origin: Pt): List<Pt> {
        val c = centroid(points)
        return points.map { Pt(it.x + origin.x - c.x, it.y + origin.y - c.y) }
    }

    private fun centroid(points: List<Pt>): Pt {
        var sx = 0f
        var sy = 0f
        for (p in points) {
            sx += p.x
            sy += p.y
        }
        val n = points.size.toFloat()
        return Pt(sx / n, sy / n)
    }

    private fun distanceAtBestAngle(pts: List<Pt>, tpl: List<Pt>): Float {
        var a = -ANGLE_RANGE
        var b = ANGLE_RANGE
        var x1 = PHI * a + (1 - PHI) * b
        var f1 = distanceAtAngle(pts, tpl, x1)
        var x2 = (1 - PHI) * a + PHI * b
        var f2 = distanceAtAngle(pts, tpl, x2)
        while (b - a > ANGLE_PREC) {
            if (f1 < f2) {
                b = x2
                x2 = x1
                f2 = f1
                x1 = PHI * a + (1 - PHI) * b
                f1 = distanceAtAngle(pts, tpl, x1)
            } else {
                a = x1
                x1 = x2
                f1 = f2
                x2 = (1 - PHI) * a + PHI * b
                f2 = distanceAtAngle(pts, tpl, x2)
            }
        }
        return min(f1, f2)
    }

    private fun distanceAtAngle(pts: List<Pt>, tpl: List<Pt>, radians: Float): Float {
        val rotated = rotateBy(pts, radians)
        val n = min(rotated.size, tpl.size)
        if (n == 0) return Float.POSITIVE_INFINITY
        var sum = 0f
        for (i in 0 until n) sum += dist(rotated[i], tpl[i])
        return sum / n
    }

    private fun dist(a: Pt, b: Pt) = hypot((a.x - b.x).toDouble(), (a.y - b.y).toDouble()).toFloat()

    fun synthetic(id: String): List<Pt> {
        val pts = ArrayList<Pt>()
        when (id) {
            "task" -> {
                // tiny cluster / tap
                for (i in 0 until N) pts.add(Pt(2f * sin(i.toFloat()), 2f * cos(i.toFloat())))
            }
            "note" -> for (i in 0 until N) pts.add(Pt(i.toFloat(), 0f))
            "event" -> for (i in 0 until N) {
                val a = i * 2f * Math.PI.toFloat() / (N - 1)
                pts.add(Pt(50f * cos(a), 50f * sin(a)))
            }
            "expand" -> for (i in 0 until N) pts.add(Pt(i.toFloat(), -i.toFloat()))
            "finance" -> for (i in 0 until N) {
                val t = i / (N - 1f)
                pts.add(Pt(20f * sin(t * 3f * Math.PI.toFloat()), t * 80f))
            }
            "urgent" -> for (i in 0 until N) pts.add(Pt(0f, i.toFloat()))
            else -> for (i in 0 until N) pts.add(Pt(i.toFloat(), 0f))
        }
        return normalize(pts)
    }
}
