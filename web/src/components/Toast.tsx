import React, { useCallback, useRef, useState } from 'react'

export type ToastKind = 'ok' | 'error'
export type ToastItem = { id: number; message: string; kind?: ToastKind }

export function useToastQueue(timeoutMs = 3200) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(1)

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(item => item.id !== id))
  }, [])

  const push = useCallback((message: string, kind?: ToastKind) => {
    const id = idRef.current++
    setItems(prev => [...prev, { id, message, kind }])
    window.setTimeout(() => {
      setItems(prev => prev.filter(item => item.id !== id))
    }, timeoutMs)
  }, [timeoutMs])

  return { items, push, remove }
}

export function ToastShelf({ items, onDismiss }: { items: ToastItem[]; onDismiss?: (id: number) => void }) {
  if (!items.length) return null

  return (
    <div className="toast-shelf" role="status" aria-live="polite">
      {items.map(item => (
        <div key={item.id} className={`toast ${item.kind || ''}`}>
          <span className="toast__content">{item.message}</span>
          {onDismiss ? (
            <button
              type="button"
              className="toast__close"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(item.id)}
            >
              x
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
