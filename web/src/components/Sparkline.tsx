import React, { useEffect, useMemo, useRef } from 'react'

export type SparklinePoint = {
  value: number
  label?: string
}

type SparklineProps = {
  data: SparklinePoint[]
  loading?: boolean
  width?: number
  height?: number
  className?: string
  stroke?: string
  fill?: string
  ariaLabel?: string
}

const DEFAULT_WIDTH = 120
const DEFAULT_HEIGHT = 32

function resolveCssVar(name: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name)
    return value?.trim() || fallback
  } catch {
    return fallback
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

function drawSparkline(
  canvas: HTMLCanvasElement,
  data: SparklinePoint[],
  width: number,
  height: number,
  stroke?: string,
  fill?: string,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }

  const ratio = window.devicePixelRatio || 1
  const displayWidth = Math.max(1, Math.round(width))
  const displayHeight = Math.max(1, Math.round(height))
  canvas.style.width = `${displayWidth}px`
  canvas.style.height = `${displayHeight}px`
  canvas.width = displayWidth * ratio
  canvas.height = displayHeight * ratio
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)

  ctx.clearRect(0, 0, displayWidth, displayHeight)

  if (!data.length) {
    // Draw a subtle baseline to avoid a blank canvas when no data is present.
    const fallbackStroke = stroke || resolveCssVar('--muted', '#6b7280')
    ctx.strokeStyle = fallbackStroke
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, displayHeight - 1)
    ctx.lineTo(displayWidth, displayHeight - 1)
    ctx.stroke()
    return
  }

  const values = data.map(point => clamp(point.value ?? 0, 0, Number.MAX_SAFE_INTEGER))
  const maxValue = values.reduce((acc, value) => (value > acc ? value : acc), 0)
  const minValue = values.reduce((acc, value) => (value < acc ? value : acc), maxValue)
  const span = Math.max(1, maxValue - minValue)

  const resolvedStroke = stroke || resolveCssVar('--accent', '#60a5fa')
  const resolvedFill = fill || `${resolvedStroke}44`

  const verticalPadding = 2
  const horizontalPadding = 0.5
  const plotHeight = displayHeight - verticalPadding * 2
  const plotWidth = displayWidth - horizontalPadding * 2

  const points = values.map((value, index) => {
    const x =
      values.length === 1
        ? horizontalPadding + plotWidth / 2
        : horizontalPadding + (plotWidth * index) / (values.length - 1)
    const normalized = (value - minValue) / span
    const y = verticalPadding + plotHeight - normalized * plotHeight
    return { x, y }
  })

  ctx.beginPath()
  ctx.moveTo(points[0].x, displayHeight - verticalPadding)
  points.forEach(point => {
    ctx.lineTo(point.x, point.y)
  })
  ctx.lineTo(points[points.length - 1].x, displayHeight - verticalPadding)
  ctx.closePath()
  ctx.fillStyle = resolvedFill
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i += 1) {
    const current = points[i]
    const previous = points[i - 1]
    const midX = (previous.x + current.x) / 2
    ctx.quadraticCurveTo(previous.x, previous.y, midX, (previous.y + current.y) / 2)
    ctx.quadraticCurveTo(current.x, current.y, current.x, current.y)
  }
  ctx.strokeStyle = resolvedStroke
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  const lastPoint = points[points.length - 1]
  ctx.beginPath()
  ctx.arc(lastPoint.x, lastPoint.y, 2.2, 0, Math.PI * 2)
  ctx.fillStyle = resolvedStroke
  ctx.fill()
}

export function buildSparklineSeries(
  byDay: { date: string; count: number }[],
  windowDays = 7,
): SparklinePoint[] {
  const safeWindow = Math.max(1, Math.min(windowDays, 365))
  const map = new Map<string, number>()
  byDay.forEach(({ date, count }) => {
    if (!date) return
    map.set(date, (map.get(date) || 0) + Math.max(0, count || 0))
  })

  const result: SparklinePoint[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = safeWindow - 1; i >= 0; i -= 1) {
    const current = new Date(today)
    current.setDate(today.getDate() - i)
    const key = current.toISOString().slice(0, 10)
    const count = map.get(key) || 0
    result.push({ value: count, label: key })
  }
  return result
}

export function Sparkline({
  data,
  loading = false,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  className,
  stroke,
  fill,
  ariaLabel,
}: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const safeData = useMemo(() => (
    Array.isArray(data) ? data.filter(point => Number.isFinite(point.value)) : []
  ), [data])

  useEffect(() => {
    if (loading) return
    if (!canvasRef.current) return
    drawSparkline(canvasRef.current, safeData, width, height, stroke, fill)
  }, [loading, safeData, width, height, stroke, fill])

  if (loading) {
    return (
      <div
        className={className}
        style={{
          width,
          height,
          borderRadius: 6,
          background: 'linear-gradient(90deg, rgba(107,114,128,0.25), rgba(107,114,128,0.45), rgba(107,114,128,0.25))',
          backgroundSize: '200% 100%',
          animation: 'sparkline-skeleton 1.6s ease-in-out infinite',
        }}
        aria-hidden
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={ariaLabel || 'Sparkline'}
      style={{ display: 'block', width, height }}
    />
  )
}

// Inject a lightweight keyframe animation once to avoid depending on global styles.
if (typeof document !== 'undefined') {
  const styleId = 'sparkline-skeleton-style'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `@keyframes sparkline-skeleton { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }`
    document.head.appendChild(style)
  }
}

