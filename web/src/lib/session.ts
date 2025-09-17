import { useCallback, useEffect, useState } from 'react'

import { apiGet } from './api'

export type SessionUser = {
  email: string
  name?: string | null
}

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error'

export type SessionState = {
  status: SessionStatus
  user: SessionUser | null
  error: string | null
}

type SessionListener = (state: SessionState) => void

const SUCCESS_INTERVAL_MS = 30_000
const INITIAL_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 60_000

let state: SessionState = { status: 'loading', user: null, error: null }
const listeners = new Set<SessionListener>()
let pollTimer: number | null = null
let retryDelay = INITIAL_BACKOFF_MS
let inflight: Promise<void> | null = null
let started = false

function notify() {
  listeners.forEach(listener => listener(state))
}

function setState(next: SessionState) {
  const changed =
    state.status !== next.status ||
    state.user?.email !== next.user?.email ||
    state.user?.name !== next.user?.name ||
    state.error !== next.error
  state = next
  if (changed) {
    notify()
  }
}

function normalizeError(error: unknown): { unauthenticated: boolean; message: string } {
  const raw = error instanceof Error ? error.message : String(error ?? 'unknown_error')
  const normalized = raw.toLowerCase()
  const unauthenticated =
    normalized.includes('auth_required') ||
    normalized.includes('unauthorized') ||
    normalized.includes('not_found')
  return { unauthenticated, message: raw }
}

async function fetchSession() {
  try {
    const user = await apiGet<SessionUser>('/auth/me')
    retryDelay = INITIAL_BACKOFF_MS
    setState({ status: 'authenticated', user, error: null })
  } catch (error) {
    const { unauthenticated, message } = normalizeError(error)
    if (unauthenticated) {
      setState({ status: 'unauthenticated', user: null, error: null })
    } else {
      setState({ status: 'error', user: null, error: message })
    }
  }
}

function scheduleNextPoll() {
  if (!listeners.size) {
    return
  }
  const delay = state.status === 'authenticated' ? SUCCESS_INTERVAL_MS : retryDelay
  pollTimer = window.setTimeout(() => {
    pollTimer = null
    void refreshSession()
  }, delay)
  if (state.status !== 'authenticated') {
    retryDelay = Math.min(retryDelay * 2, MAX_BACKOFF_MS)
  } else {
    retryDelay = INITIAL_BACKOFF_MS
  }
}

function ensurePolling() {
  if (!listeners.size) {
    return
  }
  if (!started) {
    started = true
    void refreshSession(true)
    return
  }
  if (pollTimer == null && inflight == null) {
    scheduleNextPoll()
  }
}

function clearTimer() {
  if (pollTimer != null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

export async function refreshSession(forceImmediate = false): Promise<SessionState> {
  if (forceImmediate) {
    retryDelay = INITIAL_BACKOFF_MS
  }
  clearTimer()
  if (!inflight) {
    inflight = fetchSession().finally(() => {
      inflight = null
      scheduleNextPoll()
    })
  }
  await inflight
  return state
}

export function setSessionUser(user: SessionUser | null) {
  retryDelay = INITIAL_BACKOFF_MS
  if (user) {
    setState({ status: 'authenticated', user, error: null })
  } else {
    setState({ status: 'unauthenticated', user: null, error: null })
  }
  clearTimer()
  scheduleNextPoll()
}

export function useSession() {
  const [current, setCurrent] = useState(state)

  useEffect(() => {
    const listener: SessionListener = next => setCurrent(next)
    listeners.add(listener)
    listener(state)
    ensurePolling()
    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        clearTimer()
      }
    }
  }, [])

  const refresh = useCallback(() => refreshSession(true), [])

  return { ...current, refresh }
}
