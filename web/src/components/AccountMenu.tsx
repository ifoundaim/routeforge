import React, { useEffect, useId, useRef, useState } from 'react'

import { apiPost } from '../lib/api'
import { refreshSession, setSessionUser } from '../lib/session'

type AccountMenuProps = {
  email: string
}

export function AccountMenu({ email }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonId = useId()

  useEffect(() => {
    if (!open) return

    const handlePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('pointerdown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setError(null)
    }
  }, [open])

  const toggle = () => {
    setOpen(prev => !prev)
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    setError(null)
    let treatAsSuccess = false
    try {
      await apiPost<Record<string, never>, unknown>('/auth/logout', {})
      treatAsSuccess = true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign out failed'
      if (message && message.toLowerCase().includes('not_found')) {
        treatAsSuccess = true
      } else {
        setError(message || 'Sign out failed')
      }
    }
    setSigningOut(false)

    if (treatAsSuccess) {
      setError(null)
      setOpen(false)
      setSessionUser(null)
      await refreshSession(true)
    }
  return (
    <div className="account-menu" ref={containerRef}>
      <button
        id={buttonId}
        type="button"
        className="account-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="account-menu__label">Account</span>
        <span className="account-menu__email">{email}</span>
        <span aria-hidden="true" className="account-menu__caret">▾</span>
      </button>
      {open ? (
        <div className="account-menu__dropdown" role="menu" aria-labelledby={buttonId}>
          <a className="account-menu__item" role="menuitem" href="/app">
            My Projects
          </a>
          <button
            type="button"
            role="menuitem"
            className="account-menu__item account-menu__signout"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          {error ? (
            <p className="account-menu__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
