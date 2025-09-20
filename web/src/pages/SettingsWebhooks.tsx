import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { apiGet, apiPost } from '../lib/api'
import '../styles/webhooks.css'

type Webhook = {
  id: number
  url: string
  event: 'release_published' | 'route_hit' | string
  active: boolean
  secret: string
}

type TestResult = {
  ok: boolean
  status: number
  ts: string
  payload_preview: string
}

function useClipboard() {
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }, [])
  return { copy }
}

export function SettingsWebhooks() {
  const [items, setItems] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createUrl, setCreateUrl] = useState('')
  const [createSecret, setCreateSecret] = useState('')
  const [createEvents, setCreateEvents] = useState<Array<'release_published' | 'route_hit'>>(['release_published'])
  const [testing, setTesting] = useState<number | null>(null)
  const [lastResult, setLastResult] = useState<TestResult | null>(null)

  const { copy } = useClipboard()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<Webhook[]>('/api/webhooks')
      setItems(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load webhooks.'
      setError(message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const previous = document.title
    document.title = 'Webhooks — RouteForge'
    void load()
    return () => { document.title = previous }
  }, [load])

  const canCreate = useMemo(() => {
    const u = (createUrl || '').trim()
    if (!u) return false
    try { new URL(u) } catch { return false }
    return (createEvents && createEvents.length > 0)
  }, [createUrl, createEvents])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canCreate) return
    setCreating(true)
    setError(null)
    try {
      const url = createUrl.trim()
      const secret = createSecret.trim()
      const createdMany = await Promise.all(createEvents.map(async (ev) => {
        const payload = { url, event: ev, ...(secret ? { secret } : {}) }
        const created = await apiPost<typeof payload, Webhook>('/api/webhooks', payload)
        return created
      }))
      setItems(prev => [...createdMany, ...prev])
      setCreateUrl('')
      setCreateSecret('')
      setCreateEvents(['release_published'])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create webhook.'
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async (id: number) => {
    try {
      await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(x => x.id !== id))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to delete webhook.'
      setError(message)
    }
  }

  const onTest = async (id: number) => {
    setTesting(id)
    setLastResult(null)
    setError(null)
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const text = await res.text()
      const data = text ? (JSON.parse(text) as TestResult) : null
      if (!res.ok) {
        throw new Error((data && (data as any).error) || `${res.status}`)
      }
      setLastResult(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test delivery failed.'
      setError(message)
    } finally {
      setTesting(null)
    }
  }

  return (
    <main className="webhooks" id="main">
        <div className="heading" style={{ margin: '0 0 12px' }}>Webhooks</div>
        <div className="webhooks-grid">
          <section className="card webhooks-form">
            <h2>Create webhook</h2>
            <form onSubmit={onCreate} className="webhooks-form__body">
              <label className="field">
                <span>URL</span>
                <div className="field-row">
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/webhook"
                    value={createUrl}
                    onChange={e => setCreateUrl(e.target.value)}
                  />
                  <button type="button" className="ghost" onClick={() => void copy(createUrl)} disabled={!createUrl}>Copy</button>
                </div>
              </label>
              <label className="field">
                <span>Secret (optional)</span>
                <div className="field-row">
                  <input
                    type="text"
                    placeholder="Provided to your endpoint for signature verification"
                    value={createSecret}
                    onChange={e => setCreateSecret(e.target.value)}
                  />
                  <button type="button" className="ghost" onClick={() => void copy(createSecret)} disabled={!createSecret}>Copy</button>
                </div>
              </label>
              <label className="field">
                <span>Events</span>
                <select
                  multiple
                  value={createEvents}
                  onChange={e => setCreateEvents(Array.from(e.target.selectedOptions).map(o => o.value as any))}
                  size={2}
                >
                  <option value="release_published">release_published</option>
                  <option value="route_hit">route_hit</option>
                </select>
              </label>
              <div className="actions">
                <button type="submit" disabled={!canCreate || creating}>{creating ? 'Creating…' : 'Create webhook'}</button>
              </div>
            </form>
          </section>

          <section className="card webhooks-list">
            <div className="webhooks-list__header">
              <h2>Your webhooks</h2>
              <button type="button" className="ghost" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            </div>
            {error ? (
              <div className="webhooks-error" role="alert">{error}</div>
            ) : null}
            {!error && !items.length && !loading ? (
              <p className="muted">No webhooks added yet.</p>
            ) : null}
            {items.length ? (
              <ul className="webhooks-items">
                {items.map(w => (
                  <li key={w.id} className="webhooks-item">
                    <div className="webhooks-item__main">
                      <div className="webhooks-item__url">
                        <code>{w.url}</code>
                        <button className="ghost" type="button" onClick={() => void copy(w.url)}>Copy</button>
                      </div>
                      <div className="webhooks-item__meta">
                        <span className="badge">{w.event}</span>
                        <span className="dot" aria-hidden>•</span>
                        <span className={w.active ? 'ok' : 'muted'}>{w.active ? 'Active' : 'Inactive'}</span>
                      </div>
                      <div className="webhooks-item__secret">
                        <span className="muted">Secret</span>
                        <code>{w.secret}</code>
                        <button className="ghost" type="button" onClick={() => void copy(w.secret)}>Copy</button>
                      </div>
                    </div>
                    <div className="webhooks-item__actions">
                      <button type="button" onClick={() => void onTest(w.id)} disabled={testing === w.id}>{testing === w.id ? 'Sending…' : 'Send test'}</button>
                      <button type="button" className="danger" onClick={() => void onDelete(w.id)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="webhooks-last">
              <h3>Last delivery</h3>
              {!lastResult ? (
                <p className="muted">Send a test to see the last delivery status.</p>
              ) : (
                <div className="webhooks-last__body">
                  <div className="webhooks-last__row">
                    <span className="muted">Status</span>
                    <span className={lastResult.ok ? 'ok' : 'error'}>{lastResult.status || '—'}</span>
                  </div>
                  <div className="webhooks-last__row">
                    <span className="muted">Sent at</span>
                    <time>{lastResult.ts}</time>
                  </div>
                  <div className="webhooks-last__row">
                    <span className="muted">Payload</span>
                    <code className="truncate">{lastResult.payload_preview}</code>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
    </main>
  )
}


