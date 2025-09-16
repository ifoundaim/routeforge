import { useCallback, useEffect, useState } from 'react'

type EntitlementsResponse = {
  pro: boolean
}

const API_BASE = ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = (data && (data.error || data.detail || data.message)) || `${res.status}`
    throw new Error(message)
  }
  return data as T
}

export function useEntitlements() {
  const [pro, setPro] = useState(false)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await request<EntitlementsResponse>('/api/entitlements')
      setPro(Boolean(res?.pro))
      return Boolean(res?.pro)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.error('Failed to load entitlements', error)
      setPro(false)
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => {
      /* surface via console/toast elsewhere */
    })
  }, [refresh])

  const upgradeToPro = useCallback(async (value: boolean = true) => {
    setUpgrading(true)
    setError(null)
    try {
      const res = await request<EntitlementsResponse>('/dev/upgrade', {
        method: 'POST',
        body: JSON.stringify({ pro: value }),
      })
      setPro(Boolean(res?.pro))
      return Boolean(res?.pro)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      throw error
    } finally {
      setUpgrading(false)
    }
  }, [])

  return { pro, loading, refresh, upgradeToPro, upgrading, error }
}
