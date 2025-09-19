import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

import '../styles/global.css'

const PRESENT_STORAGE_KEY = 'routeforge:present-mode'
const PRESENT_SESSION_KEY = 'routeforge:present-mode:session'

type PresentModeContextValue = {
  present: boolean
  forced: boolean
  setPresent: (value: boolean) => void
  togglePresent: () => void
}

const PresentModeContext = createContext<PresentModeContextValue | undefined>(undefined)

function readStoredPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(PRESENT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function readSessionOverride(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(PRESENT_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function usePresentMode(): PresentModeContextValue | undefined {
  return useContext(PresentModeContext)
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [present, setPresent] = useState(false)
  const [forced, setForced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const queryForces = params.get('present') === '1'
    const sessionForced = readSessionOverride()

    if (queryForces || sessionForced) {
      setPresent(true)
      setForced(true)
      try {
        sessionStorage.setItem(PRESENT_SESSION_KEY, '1')
      } catch {
        /* ignore */
      }
      return
    }

    setPresent(readStoredPreference())
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const root = document.documentElement
    const body = document.body
    root.classList.toggle('present', present)
    body.classList.toggle('present', present)
    return () => {
      root.classList.remove('present')
      body.classList.remove('present')
    }
  }, [present])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (forced) return
    try {
      localStorage.setItem(PRESENT_STORAGE_KEY, present ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [present, forced])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handle = (event: StorageEvent) => {
      if (event.key !== PRESENT_STORAGE_KEY || forced) return
      setPresent(event.newValue === '1')
    }
    window.addEventListener('storage', handle)
    return () => window.removeEventListener('storage', handle)
  }, [forced])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const shell = document.querySelector('.app-shell')
    if (!shell) return

    const ensureMainTarget = () => {
      const target = shell.querySelector('#main') as HTMLElement | null
      if (target) {
        if (!target.hasAttribute('tabindex')) {
          target.setAttribute('tabindex', '-1')
        }
        return
      }
      const fallback = shell.querySelector('main') as HTMLElement | null
      if (fallback) {
        fallback.setAttribute('id', 'main')
        if (!fallback.hasAttribute('tabindex')) {
          fallback.setAttribute('tabindex', '-1')
        }
      }
    }

    ensureMainTarget()
    const observer = new MutationObserver(() => ensureMainTarget())
    observer.observe(shell, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  const contextValue = useMemo<PresentModeContextValue>(() => ({
    present,
    forced,
    setPresent: (value: boolean) => {
      if (forced) return
      setPresent(value)
    },
    togglePresent: () => {
      if (forced) return
      setPresent(prev => !prev)
    },
  }), [present, forced])

  return (
    <PresentModeContext.Provider value={contextValue}>
      <div className="app-shell">
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
      </div>
    </PresentModeContext.Provider>
  )
}
