import React, { useEffect, useState } from 'react'

import { AccountMenu } from '../components/AccountMenu'
import { PresentToggle } from '../components/PresentToggle'
import { AuthRequestLink } from '../pages/AuthRequestLink'
import { useSession } from '../lib/session'
import { usePresentMode } from './AppLayout'

function useCurrentPathname(): string {
  const readPath = () => {
    if (typeof window === 'undefined') return '/'
    return window.location.pathname || '/'
  }

  const [pathname, setPathname] = useState<string>(readPath)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handle = () => setPathname(readPath())

    const wrap = (method: typeof history.pushState) => (...args: Parameters<typeof history.pushState>) => {
      const result = method.apply(history, args)
      handle()
      return result
    }

    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState
    history.pushState = wrap(originalPushState) as typeof history.pushState
    history.replaceState = wrap(originalReplaceState) as typeof history.replaceState
    window.addEventListener('popstate', handle)

    return () => {
      history.pushState = originalPushState
      history.replaceState = originalReplaceState
      window.removeEventListener('popstate', handle)
    }
  }, [])

  return pathname
}

// Theme toggle component
type ThemePref = 'system' | 'light' | 'dark'
function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem('theme') as ThemePref) || 'system')
  useEffect(() => {
    const root = document.documentElement
    if (pref === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', pref)
    }
    localStorage.setItem('theme', pref)
  }, [pref])
  return { pref, setPref }
}

function ThemeToggle() {
  const { pref, setPref } = useTheme()
  const { present } = usePresentMode() || { present: false }
  
  const cycle = () => setPref(pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system')
  const label = pref === 'system' ? 'System' : pref === 'light' ? 'Light' : 'Dark'
  
  return (
    <button 
      className={`header__theme-toggle ${present ? 'header__theme-toggle--present' : ''}`}
      onClick={cycle} 
      title={`Theme: ${label}`}
      aria-label={`Switch theme to ${label === 'System' ? 'light' : label === 'Light' ? 'dark' : 'system'}`}
    >
      <span className="header__theme-icon" aria-hidden="true">
        {pref === 'light' ? '☀️' : pref === 'dark' ? '🌙' : '🖥️'}
      </span>
      {!present && (
        <span className="header__theme-label">{label}</span>
      )}
    </button>
  )
}

// Present mode badge
function PresentModeBadge() {
  const { present } = usePresentMode() || { present: false }
  
  if (!present) return null
  
  return (
    <span className="header__present-badge" role="status" aria-label="Present mode active">
      <span className="header__present-icon" aria-hidden="true">📺</span>
      <span className="header__present-text">Present</span>
    </span>
  )
}

export function Header() {
  const { status, user, error, refresh } = useSession()
  const [showAuth, setShowAuth] = useState(false)
  const { present } = usePresentMode() || { present: false }

  const openAuth = () => setShowAuth(true)
  const closeAuth = () => setShowAuth(false)

  useEffect(() => {
    const handler = () => setShowAuth(true)
    window.addEventListener('routeforge:open-auth', handler)
    return () => {
      window.removeEventListener('routeforge:open-auth', handler)
    }
  }, [])

  const renderAction = () => {
    if (status === 'authenticated' && user) {
      return <AccountMenu email={user.email} />
    }
    if (status === 'loading') {
      return <span className="header__status" aria-live="polite">Checking session…</span>
    }
    if (status === 'error') {
      return (
        <div className="header__error" role="status">
          <span>{error || 'Unable to verify session.'}</span>
          <button type="button" onClick={() => { void refresh() }} className="header__retry">Try again</button>
        </div>
      )
    }
    return (
      <button
        type="button"
        className="header__signin"
        onClick={openAuth}
        aria-haspopup="dialog"
      >
        Sign in
      </button>
    )
  }

  const headerClasses = [
    'header',
    present && 'header--present'
  ].filter(Boolean).join(' ')

  return (
    <>
      <header className={headerClasses} role="banner">
        <div className="header__content">
          {/* App branding */}
          <div className="header__brand">
            <a href="/app" className="header__brand-link" aria-label="RouteForge home">
              <span className="header__brand-icon" aria-hidden="true">⚡</span>
              <span className="header__brand-text">RouteForge</span>
            </a>
          </div>

          {/* Present mode badge */}
          <PresentModeBadge />

          {/* Header actions */}
          <div className="header__actions">
            <ThemeToggle />
            <PresentToggle />
            <div className="header__auth">
              {renderAction()}
            </div>
          </div>
        </div>
      </header>
      <AuthRequestLink open={showAuth} onClose={closeAuth} />
    </>
  )
}
