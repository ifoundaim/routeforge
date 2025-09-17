import React, { useEffect, useRef, useState } from 'react'

import { apiPost } from '../lib/api'
import { useSession } from '../lib/session'

export type AuthRequestLinkProps = {
  open: boolean
  onClose: () => void
}

type ViewState = 'idle' | 'loading' | 'success' | 'error'

export function AuthRequestLink({ open, onClose }: AuthRequestLinkProps) {
  const { status: sessionStatus } = useSession()
  const [email, setEmail] = useState('')
  const [viewState, setViewState] = useState<ViewState>('idle')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 20)

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKey)

    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setViewState('idle')
      setError(null)
      return
    }
    setViewState('idle')
    setError(null)
  }, [open])

  useEffect(() => {
    if (open && sessionStatus === 'authenticated') {
      onClose()
    }
  }, [open, sessionStatus, onClose])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email) return
    setViewState('loading')
    setError(null)
    try {
      const res = await apiPost<{ email: string }, { detail: string; dev_link?: string }>('/auth/request-link', { email })
      if (res && res.dev_link) {
        window.location.href = res.dev_link
        return
      }
      setViewState('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to send link'
      setError(message || 'Unable to send link')
      setViewState('error')
    }
  }

  const handleBackdrop = (event: React.MouseEvent<HTMLDivElement>) => {
    if (dialogRef.current && dialogRef.current.contains(event.target as Node)) {
      return
    }
    onClose()
  }

  if (!open) return null

  return (
    <div className="auth-layer" role="presentation" onMouseDown={handleBackdrop}>
      <div className="auth-layer__dialog" role="dialog" aria-modal="true" aria-labelledby="auth-link-title" ref={dialogRef}>
        {viewState === 'success' ? (
          <div className="auth-layer__success">
            <h2 id="auth-link-title">Check your email</h2>
            <p>We sent you a sign-in link. In demo mode the URL is also logged to the server console.</p>
            <button type="button" onClick={onClose} className="auth-layer__close">Close</button>
          </div>
        ) : (
          <form className="auth-layer__form" onSubmit={submit}>
            <h2 id="auth-link-title">Sign in</h2>
            <p className="auth-layer__copy">Enter your email to get a one-time magic link.</p>
            <p className="auth-layer__copy" aria-live="polite">New here? Register by entering your email — we’ll create your account after you click the link.</p>
            <label className="auth-layer__label" htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              ref={inputRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
            />
            {error ? (
              <p className="auth-layer__error" role="alert">{error}</p>
            ) : null}
            <div className="auth-layer__actions">
              <button type="button" onClick={onClose} className="auth-layer__cancel">Cancel</button>
              <button type="submit" className="auth-layer__submit" disabled={viewState === 'loading'}>
                {viewState === 'loading' ? 'Sending…' : 'Send magic link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
