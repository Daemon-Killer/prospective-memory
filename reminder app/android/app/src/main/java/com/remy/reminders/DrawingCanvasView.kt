package com.remy.reminders

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/**
 * High-performance, low-latency drawing canvas for rapid visual sketch and handwriting capture.
 * @deprecated Handwritten ink feature has been retired from primary capture in favor of home/lockscreen widgets.
 */
@Deprecated("Handwritten ink feature has been retired from primary capture in favor of home/lockscreen widgets.")
class DrawingCanvasView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    data class Point(val x: Float, val y: Float, val time: Long = System.currentTimeMillis())

    data class Stroke(
        val path: Path,
        val color: Int,
        val width: Float,
        val points: MutableList<Point> = mutableListOf()
    )

    private val strokes = mutableListOf<Stroke>()
    private var currentStroke: Stroke? = null
    private var lastX = 0f
    private var lastY = 0f

    var strokeColor: Int = Color.WHITE
        set(value) {
            field = value
            currentPaint.color = value
        }

    var strokeWidth: Float = 6f
        set(value) {
            field = value
            currentPaint.strokeWidth = value
        }

    private val currentPaint = Paint().apply {
        isAntiAlias = true
        isDither = true
        color = strokeColor
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        strokeWidth = this@DrawingCanvasView.strokeWidth
    }

    init {
        setBackgroundColor(Color.parseColor("#0A0A0A"))
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        for (stroke in strokes) {
            val paint = Paint(currentPaint).apply {
                color = stroke.color
                strokeWidth = stroke.width
            }
            canvas.drawPath(stroke.path, paint)
        }

        currentStroke?.let {
            canvas.drawPath(it.path, currentPaint)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x
        val y = event.y

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val path = Path().apply { moveTo(x, y) }
                val stroke = Stroke(
                    path = path,
                    color = strokeColor,
                    width = strokeWidth
                ).apply {
                    points.add(Point(x, y))
                }
                currentStroke = stroke
                lastX = x
                lastY = y
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = abs(x - lastX)
                val dy = abs(y - lastY)
                if (dx >= 2 || dy >= 2) {
                    currentStroke?.let {
                        it.path.quadTo(lastX, lastY, (x + lastX) / 2f, (y + lastY) / 2f)
                        it.points.add(Point(x, y))
                    }
                    lastX = x
                    lastY = y
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                currentStroke?.let {
                    it.path.lineTo(x, y)
                    it.points.add(Point(x, y))
                    strokes.add(it)
                }
                currentStroke = null
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    fun undo() {
        if (strokes.isNotEmpty()) {
            strokes.removeAt(strokes.size - 1)
            invalidate()
        }
    }

    fun clear() {
        strokes.clear()
        currentStroke = null
        invalidate()
    }

    fun hasStrokes(): Boolean = strokes.isNotEmpty()

    fun getStrokesCount(): Int = strokes.size

    fun getStrokesJson(): String {
        val root = JSONObject()
        root.put("v", 1)
        root.put("w", width.takeIf { it > 0 } ?: 320)
        root.put("h", height.takeIf { it > 0 } ?: 240)

        val strokeArray = JSONArray()
        for (stroke in strokes) {
            val sObj = JSONObject()
            sObj.put("c", String.format("#%06X", 0xFFFFFF and stroke.color))
            sObj.put("w", stroke.width)

            val ptArray = JSONArray()
            for (pt in stroke.points) {
                val p = JSONArray()
                p.put(pt.x.toDouble())
                p.put(pt.y.toDouble())
                ptArray.put(p)
            }
            sObj.put("pts", ptArray)
            strokeArray.put(sObj)
        }
        root.put("strokes", strokeArray)
        return root.toString()
    }

    fun getBitmap(): Bitmap {
        val w = if (width > 0) width else 320
        val h = if (height > 0) height else 240
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.parseColor("#000000"))
        draw(canvas)
        return bitmap
    }
}
