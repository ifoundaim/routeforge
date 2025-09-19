import React, { useEffect, useMemo, useRef, useState } from 'react'

type Step = {
  key: string
  selector: string
  title: string
  body?: string
}

type TourProps = {
  steps: Step[]
  active: boolean
  onClose: () => void
}

function getRect(el: Element | null): DOMRect | null {
  if (!el) return null
  const rect = (el as HTMLElement).getBoundingClientRect()
  return rect
}

function scrollIntoViewIfNeeded(target: Element | null) {
  if (!target) return
  const rect = (target as HTMLElement).getBoundingClientRect()
  const margin = 120
  const withinVertical = rect.top >= margin && rect.bottom <= window.innerHeight - margin
  if (!withinVertical) {
    const top = Math.max(0, window.scrollY + rect.top - margin)
    window.scrollTo({ top, behavior: 'smooth' })
  }
}

export function Tour({ steps, active, onClose }: TourProps) {
  const [index, setIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const rafRef = useRef<number | null>(null)

  const step = useMemo(() => (steps && steps.length ? steps[Math.min(index, steps.length - 1)] : null), [steps, index])

  useEffect(() => {
    if (!active) return
    const handle = () => {
      if (!step) return
      const el = document.querySelector(step.selector)
      setTargetRect(getRect(el))
    }
    handle()
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(handle)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize)
    }
  }, [active, step])

  useEffect(() => {
    if (!active || !step) return
    const el = document.querySelector(step.selector)
    scrollIntoViewIfNeeded(el)
    setTimeout(() => setTargetRect(getRect(el)), 160)
  }, [active, step])

  useEffect(() => {
    if (!active) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [active])

  if (!active || !step) return null

  const rect = targetRect
  const highlightStyle: React.CSSProperties = rect
    ? {
        left: Math.max(8, window.scrollX + rect.left - 8),
        top: Math.max(8, window.scrollY + rect.top - 8),
        width: Math.max(0, rect.width + 16),
        height: Math.max(0, rect.height + 16),
      }
    : { left: -9999, top: -9999, width: 0, height: 0 }

  const next = () => setIndex(i => Math.min(i + 1, steps.length - 1))
  const prev = () => setIndex(i => Math.max(i - 1, 0))
  const done = () => onClose()

  const canPrev = index > 0
  const canNext = index < steps.length - 1

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Demo tour">
      <div className="tour-backdrop" onClick={done} />
      <div className="tour-highlight" style={highlightStyle} />
      <div className="tour-popover" style={{
        left: highlightStyle.left,
        top: typeof highlightStyle.top === 'number' ? highlightStyle.top + (rect ? rect.height + 16 : 0) : undefined,
      }}>
        <div className="tour-popover__title">{step.title}</div>
        {step.body ? <div className="tour-popover__body">{step.body}</div> : null}
        <div className="tour-popover__controls">
          <button type="button" className="ghost" onClick={done}>Close</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={prev} disabled={!canPrev}>Back</button>
          {canNext ? (
            <button type="button" onClick={next}>Next</button>
          ) : (
            <button type="button" onClick={done}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Tour


