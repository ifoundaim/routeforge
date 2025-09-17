import React, { useEffect, useState } from 'react'

import { AccountMenu } from './AccountMenu'
import { AuthRequestLink } from '../pages/AuthRequestLink'
import { useSession } from '../lib/session'
import '../styles/account.css'

export function Header() {
  const { status, user, error, refresh } = useSession()
  const [showAuth, setShowAuth] = useState(false)

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

  return (
    <>
      <header className="app-header">
        <a href="/app" className="app-header__brand" aria-label="RouteForge home">
          RouteForge
        </a>
        <div className="app-header__spacer" />
        {renderAction()}
      </header>
      <AuthRequestLink open={showAuth} onClose={closeAuth} />
    </>
  )
}
