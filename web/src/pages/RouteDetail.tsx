import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Sparkline, buildSparklineSeries } from '../components/Sparkline'
import { UTMChips, type UTMSource } from '../components/UTMChips'
import { ToastShelf, useToastQueue } from '../components/Toast'
import { apiGet } from '../lib/api'
import { OpenCta } from '../components/Route/OpenCta'
import { Header } from '../components/Header'

type RouteStats = {
  clicks: number
  by_day: { date: string; count: number }[]
  referrers: { ref: string; count: number }[]
  utm_top_sources: UTMSource[]
  user_agents: { ua: string; count: number }[]
}

type RouteHit = {
  id: number
  ts: string
  ip?: string | null
  ua?: string | null
  ref?: string | null
}

type RouteMeta = {
  id: number
  slug: string
  target_url?: string | null
}

type RouteLookupState = {
  loading: boolean
  error: string | null
}

type StatsSummary = {
  top_routes: { route_id: number; slug: string }[]
}

type EnrichedHit = RouteHit & { utm_source: string | null }

type FetchState<T> = {
  loading: boolean
  error: string | null
  data: T | null
}

function extractUtmSource(ref: string | null | undefined): string | null {
  if (!ref) return null
  const trimmed = ref.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    const value = parsed.searchParams.get('utm_source')
    if (value) return value
  } catch {
    /* not a full URL */
  }
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex >= 0) {
    const query = trimmed.slice(queryIndex + 1)
    const params = new URLSearchParams(query)
    const value = params.get('utm_source')
    if (value) return value
  }
  return null
}

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return iso
  const diffMs = Date.now() - ts
  const diffSec = Math.max(0, Math.floor(diffMs / 1000))
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const minutes = Math.floor(diffSec / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function RouteDetail() {
  const params = useParams<{ slug?: string; id?: string }>()
  const slugParam = params.slug ?? null
  const idParam = params.id ?? null
  const [routeId, setRouteId] = useState<number | null>(() => {
    if (!idParam) return null
    const parsed = Number.parseInt(idParam, 10)
    return Number.isFinite(parsed) ? parsed : null
  })
  const [slug, setSlug] = useState<string | null>(slugParam)
  const [routeMeta, setRouteMeta] = useState<RouteMeta | null>(null)
  const [routeLookup, setRouteLookup] = useState<RouteLookupState>({ loading: false, error: null })

  const [stats, setStats] = useState<FetchState<RouteStats>>({ loading: false, error: null, data: null })
  const [hits, setHits] = useState<FetchState<EnrichedHit[]>>({ loading: false, error: null, data: null })
  const [activeSource, setActiveSource] = useState<string | null>(null)
  const { items: toastItems, push: pushToast, remove: removeToast } = useToastQueue()
  const resolvedSlug = slug || routeMeta?.slug || null

  useEffect(() => {
    let active = true

    if (slugParam) {
      setSlug(slugParam)
      setRouteMeta(null)
      setRouteLookup({ loading: true, error: null })
      setRouteId(null)

      const query = encodeURIComponent(slugParam)
      apiGet<RouteMeta | RouteMeta[]>(`/api/routes?slug=${query}`)
        .then(data => {
          if (!active) return
          const maybeRoute = Array.isArray(data) ? data[0] : data
          if (!maybeRoute || typeof maybeRoute !== 'object' || typeof (maybeRoute as any).id !== 'number') {
            throw new Error('Route not found.')
          }
          const normalized = maybeRoute as RouteMeta
          setRouteMeta(normalized)
          setRouteId(normalized.id)
          setSlug((normalized.slug || slugParam) ?? null)
          setRouteLookup({ loading: false, error: null })
        })
        .catch(error => {
          if (!active) return
          const message = error instanceof Error ? error.message : 'Route not found.'
          setRouteLookup({ loading: false, error: message || 'Route not found.' })
          setRouteMeta(null)
          setRouteId(null)
        })

      return () => {
        active = false
      }
    }

    const parsed = idParam ? Number.parseInt(idParam, 10) : NaN
    const validId = Number.isFinite(parsed) ? parsed : null

    setRouteMeta(null)
    setSlug(null)
    if (validId !== null) {
      setRouteId(validId)
      setRouteLookup({ loading: false, error: null })
    } else {
      setRouteId(null)
      setRouteLookup({ loading: false, error: 'Route not found.' })
    }

    return () => {
      active = false
    }
  }, [slugParam, idParam])

  useEffect(() => {
    if (routeId !== null) return
    setStats({ loading: false, error: null, data: null })
    setHits({ loading: false, error: null, data: null })
  }, [routeId])

  useEffect(() => {
    const previous = document.title
    const resolvedSlug = slug || routeMeta?.slug || null
    const label = resolvedSlug ? `/r/${resolvedSlug}` : routeId ? `Route #${routeId}` : 'Route detail'
    document.title = `${label} — RouteForge`
    return () => {
      document.title = previous
    }
  }, [routeId, slug, routeMeta?.slug])

  useEffect(() => {
    if (!routeId) return
    let alive = true
    setStats({ loading: true, error: null, data: null })
    apiGet<RouteStats>(`/api/routes/${routeId}/stats?days=7`)
      .then(data => {
        if (!alive) return
        setStats({ loading: false, error: null, data })
      })
      .catch(error => {
        if (!alive) return
        const message = error instanceof Error ? error.message : 'Failed to load route stats.'
        setStats({ loading: false, error: message, data: null })
      })
    return () => {
      alive = false
    }
  }, [routeId])

  useEffect(() => {
    if (!routeId) return
    let alive = true
    setHits({ loading: true, error: null, data: null })
    apiGet<{ hits: RouteHit[] }>(`/api/routes/${routeId}/hits/recent?limit=20`)
      .then(payload => {
        if (!alive) return
        const items = (payload.hits || []).map(hit => ({
          ...hit,
          utm_source: extractUtmSource(hit.ref),
        }))
        setHits({ loading: false, error: null, data: items })
      })
      .catch(error => {
        if (!alive) return
        const message = error instanceof Error ? error.message : 'Failed to load recent hits.'
        setHits({ loading: false, error: message, data: null })
      })
    return () => {
      alive = false
    }
  }, [routeId])

  useEffect(() => {
    if (resolvedSlug || !routeId) return
    let alive = true
    apiGet<StatsSummary>('/api/stats/summary?days=7')
      .then(summary => {
        if (!alive) return
        const match = summary.top_routes?.find(route => route.route_id === routeId)
        if (match) setSlug(match.slug)
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      alive = false
    }
  }, [routeId, resolvedSlug])

  const baseRouteUrl = useMemo(() => {
    if (!resolvedSlug) return null
    try {
      return `${window.location.origin}/r/${resolvedSlug}`
    } catch {
      return `/r/${resolvedSlug}`
    }
  }, [resolvedSlug])

  const visibleHits = useMemo(() => {
    const items = hits.data || []
    if (!activeSource) return items
    return items.filter(hit => hit.utm_source === activeSource)
  }, [hits.data, activeSource])

  const routeLoading = routeLookup.loading
  const routeErrorMessage = !routeLoading && routeId === null ? routeLookup.error || 'Route not found.' : null

  useEffect(() => {
    if (!activeSource) return
    if (!hits.data || !hits.data.length) return
    if (visibleHits.length) return
    pushToast(`No recent hits from ${activeSource}.`, 'ok')
  }, [activeSource, visibleHits.length, hits.data, pushToast])

  if (routeLoading && routeId === null) {
    return (
      <div className="container">
        <Header />
        <main style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
          <section className="card" style={{ padding: 20 }}>
            <div className="muted">Loading route…</div>
          </section>
        </main>
        <ToastShelf items={toastItems} onDismiss={removeToast} />
      </div>
    )
  }

  if (routeErrorMessage) {
    return (
      <div className="container">
        <Header />
        <main style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
          <section className="card" style={{ padding: 20 }}>
            <div className="muted">{routeErrorMessage}</div>
          </section>
        </main>
        <ToastShelf items={toastItems} onDismiss={removeToast} />
      </div>
    )
  }

  const sparklineData = stats.data ? buildSparklineSeries(stats.data.by_day, 7) : []

  const title = resolvedSlug ? `/r/${resolvedSlug}` : routeId ? `Route #${routeId}` : 'Route detail'

  const renderHits = () => {
    if (hits.loading) {
      return (
        <div className="muted">Loading recent hits…</div>
      )
    }
    if (hits.error) {
      return <div className="muted">Error: {hits.error}</div>
    }
    const items = visibleHits
    if (!items.length) {
      return <div className="muted">No recent hits recorded.</div>
    }
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Referrer</th>
              <th>utm_source</th>
            </tr>
          </thead>
          <tbody>
            {items.map(hit => (
              <tr key={hit.id}>
                <td>{formatRelativeTime(hit.ts)}</td>
                <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hit.ref || '—'}
                </td>
                <td>{hit.utm_source || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const handleSelectSource = (source: string | null) => {
    setActiveSource(source)
  }

  const sparklineLoading = stats.loading

  return (
    <div className="container">
      <Header />
      <main style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <div className="heading" style={{ margin: 0, flex: 1 }}>{title}</div>
            <OpenCta slug={resolvedSlug || undefined} utmSource="twitter" />
          </div>
          {routeMeta?.target_url ? (
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <span className="muted">Target</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{routeMeta.target_url}</span>
              {baseRouteUrl ? (
                <button type="button" className="ghost" onClick={async () => { try { await navigator.clipboard.writeText(baseRouteUrl) } catch {} }}>Copy</button>
              ) : null}
              {routeMeta.target_url ? (
                <button type="button" className="ghost" onClick={async () => { try { await navigator.clipboard.writeText(routeMeta.target_url || '') } catch {} }}>Copy target</button>
              ) : null}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ minWidth: 140 }}>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>7d clicks</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {stats.loading ? '…' : stats.data ? stats.data.clicks.toLocaleString() : '—'}
              </div>
            </div>
            <Sparkline
              data={sparklineData}
              loading={sparklineLoading}
              width={220}
              height={48}
              ariaLabel={`7 day sparkline for ${title}`}
            />
            {stats.error ? (
              <span style={{ color: 'var(--error)', fontSize: 13 }}>{stats.error}</span>
            ) : null}
          </div>
        </section>

        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="heading" style={{ margin: 0, fontSize: 18 }}>Top utm_source</div>
          <UTMChips
            sources={stats.data?.utm_top_sources || []}
            loading={stats.loading}
            activeSource={activeSource}
            onSelect={handleSelectSource}
            emptyLabel="No UTM sources detected in the last 7 days."
          />
          {activeSource ? (
            <p className="muted" style={{ margin: 0 }}>
              Filtering hits where utm_source = <strong>{activeSource}</strong>
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Click a chip to filter the hits table by utm_source.
            </p>
          )}
        </section>

        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="heading" style={{ margin: 0, fontSize: 18 }}>Recent hits</div>
          {renderHits()}
        </section>
      </main>
      <ToastShelf items={toastItems} onDismiss={removeToast} />
    </div>
  )
}
