import React, { useEffect, useState } from 'react'

import { AccountMenu } from './AccountMenu'
import { PresentToggle } from './PresentToggle'
import { AuthRequestLink } from '../pages/AuthRequestLink'
import { useSession } from '../lib/session'
import '../styles/account.css'

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

export function Header() {
  const { status, user, error, refresh } = useSession()
  const [showAuth, setShowAuth] = useState(false)
  const pathname = useCurrentPathname()

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
      return <span className="app-header__status" aria-live="polite">Checking session…</span>
    }
    if (status === 'error') {
      return (
        <div className="app-header__error" role="status">
          <span>{error || 'Unable to verify session.'}</span>
          <button type="button" onClick={() => { void refresh() }} className="app-header__retry">Try again</button>
        </div>
      )
    }
    return (
      <button
        type="button"
        className="app-header__signin"
        onClick={openAuth}
        aria-haspopup="dialog"
      >
        Sign in
      </button>
    )
  }

  const action = renderAction()
  const isAuthenticated = status === 'authenticated' && Boolean(user)
  const dashboardActive = pathname.startsWith('/app/dashboard') || pathname.startsWith('/app/routes/')

  return (
    <>
      <header className="app-header">
        <a href="/app" className="app-header__brand" aria-label="RouteForge home">
          RouteForge
        </a>
        {isAuthenticated ? (
          <nav className="app-header__nav" role="navigation" aria-label="Primary">
            <a
              href="/app/dashboard"
              className="app-header__nav-link"
              aria-current={dashboardActive ? 'page' : undefined}
            >
              Dashboard
            </a>
          </nav>
        ) : null}
        <div className="app-header__actions">
          <PresentToggle />
          {action ? <div className="app-header__auth">{action}</div> : null}
        </div>
      </header>
      <AuthRequestLink open={showAuth} onClose={closeAuth} />
    </>
  )
}
