import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Sparkline, buildSparklineSeries } from '../components/Sparkline'
import { UTMChips, UTMSource } from '../components/UTMChips'
import { ToastShelf, useToastQueue } from '../components/Toast'
import { apiGet } from '../lib/api'
import { useSession } from '../lib/session'
import '../styles/dashboard.css'

type TopRoute = {
  route_id: number
  slug: string
  clicks: number
  release_id?: number | null
}

type StatsSummary = {
  total_clicks: number
  unique_routes: number
  top_routes: TopRoute[]
}

type RouteDailyCount = { date: string; count: number }

type RouteStats = {
  clicks: number
  by_day: RouteDailyCount[]
  referrers: { ref: string; count: number }[]
  utm_top_sources: { source: string; count: number }[]
  user_agents: { ua: string; count: number }[]
}

type RouteStatsState = {
  loading: boolean
  data: RouteStats | null
  error: string | null
}

type StatsSeries = {
  by_day_clicks: RouteDailyCount[]
  by_day_active_routes: RouteDailyCount[]
  utm_sources: UTMSource[]
}

function formatNumber(value: number | null | undefined): string {
  if (!Number.isFinite(value || 0)) return '—'
  return (value || 0).toLocaleString()
}

export function Dashboard() {
  const { status } = useSession()
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [routeStats, setRouteStats] = useState<Record<number, RouteStatsState>>({})
  const [series, setSeries] = useState<StatsSeries | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [seriesError, setSeriesError] = useState<string | null>(null)
  const [activeUTM, setActiveUTM] = useState<string | null>(null)
  const { items: toastItems, push: pushToast, remove: removeToast } = useToastQueue()

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Dashboard — RouteForge'
    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') {
      setSummary(null)
      setSummaryError(null)
      setSummaryLoading(false)
      setSeries(null)
      setSeriesError(null)
      setSeriesLoading(false)
      setActiveUTM(null)
      return
    }

    let alive = true
    setSummaryLoading(true)
    setSummaryError(null)
    apiGet<StatsSummary>('/api/stats/summary?days=7')
      .then(data => {
        if (!alive) return
        setSummary(data)
      })
      .catch(error => {
        if (!alive) return
        const message = error instanceof Error ? error.message : 'Failed to load dashboard stats.'
        setSummary(null)
        setSummaryError(message)
      })
      .finally(() => {
        if (alive) setSummaryLoading(false)
      })

    setSeriesLoading(true)
    setSeriesError(null)
    apiGet<StatsSeries>('/api/stats/series?days=7')
      .then(data => {
        if (!alive) return
        setSeries(data)
      })
      .catch(error => {
        if (!alive) return
        const message = error instanceof Error ? error.message : 'Failed to load series.'
        setSeries(null)
        setSeriesError(message)
      })
      .finally(() => {
        if (alive) setSeriesLoading(false)
      })

    return () => {
      alive = false
    }
  }, [status])

  useEffect(() => {
    if (!summary || !summary.top_routes?.length) return
    let alive = true

    summary.top_routes.forEach(route => {
      setRouteStats(prev => {
        const current = prev[route.route_id]
        if (current && (current.loading || current.data)) {
          return prev
        }
        return {
          ...prev,
          [route.route_id]: { loading: true, data: null, error: null },
        }
      })

      apiGet<RouteStats>(`/api/routes/${route.route_id}/stats?days=7`)
        .then(data => {
          if (!alive) return
          setRouteStats(prev => ({
            ...prev,
            [route.route_id]: { loading: false, data, error: null },
          }))
        })
        .catch(error => {
          if (!alive) return
          const message = error instanceof Error ? error.message : 'Unable to load route stats.'
          setRouteStats(prev => ({
            ...prev,
            [route.route_id]: { loading: false, data: null, error: message },
          }))
        })
    })

    return () => {
      alive = false
    }
  }, [summary])

  const topRoutes = useMemo(() => summary?.top_routes || [], [summary])

  const allRouteStatsSettled = useMemo(() => {
    if (!topRoutes.length) return true
    return topRoutes.every(r => {
      const s = routeStats[r.route_id]
      return Boolean(s && !s.loading)
    })
  }, [topRoutes, routeStats])

  const filteredRoutes = useMemo(() => {
    if (!activeUTM) return topRoutes
    const want = activeUTM.toLowerCase()
    const core = new Set(['twitter', 'newsletter', 'reddit'])
    return topRoutes.filter(route => {
      const s = routeStats[route.route_id]
      if (!s || !s.data) return false
      const sources = (s.data.utm_top_sources || []).map(x => (x?.source || '').toLowerCase())
      if (want === 'other') {
        return sources.some(src => src && !core.has(src))
      }
      return sources.includes(want)
    })
  }, [activeUTM, topRoutes, routeStats])

  useEffect(() => {
    if (!activeUTM) return
    if (!summary || !topRoutes.length) return
    if (!allRouteStatsSettled) return
    if (filteredRoutes.length === 0) {
      pushToast(`No routes for UTM "${activeUTM}" in the last 7 days.`, 'error')
    }
  }, [activeUTM, allRouteStatsSettled, filteredRoutes.length, pushToast, summary, topRoutes.length])

  const renderTopRoutes = () => {
    if (summaryLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="card" style={{ padding: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ width: 140, height: 12, borderRadius: 4, background: 'rgba(107,114,128,0.25)' }} />
                <div style={{ width: 90, height: 10, borderRadius: 4, background: 'rgba(107,114,128,0.2)', marginTop: 8 }} />
              </div>
              <div>
                <Sparkline data={[]} loading width={120} height={32} />
              </div>
            </div>
          ))}
        </div>
      )
    }

    if (summaryError) {
      return (
        <div className="card" style={{ padding: 16 }}>
          <p className="muted" style={{ margin: 0 }}>Error: {summaryError}</p>
        </div>
      )
    }

    if (!topRoutes.length) {
      return (
        <div className="card" style={{ padding: 16 }}>
          <p className="muted" style={{ margin: 0 }}>No routes have recorded clicks in the last 7 days.</p>
          <p className="muted" style={{ margin: '8px 0 0' }}>Hint: open one of your routes with <span className="kbd">?utm_source=twitter</span> to start tracking.</p>
        </div>
      )
    }

    const list = activeUTM ? filteredRoutes : topRoutes

    if (activeUTM && !allRouteStatsSettled && list.length === 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="card" style={{ padding: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ width: 140, height: 12, borderRadius: 4, background: 'rgba(107,114,128,0.25)' }} />
                <div style={{ width: 90, height: 10, borderRadius: 4, background: 'rgba(107,114,128,0.2)', marginTop: 8 }} />
              </div>
              <div>
                <Sparkline data={[]} loading width={120} height={32} />
              </div>
            </div>
          ))}
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.map(route => {
          const stats = routeStats[route.route_id]
          const sparkData = stats?.data ? buildSparklineSeries(stats.data.by_day, 7) : []
          const link = route.slug ? `/app/routes/${route.slug}` : `/app/routes/id/${route.route_id}`
          const shareHref = route.release_id ? `/rel/${route.release_id}` : null

          return (
            <div
              key={route.route_id}
              className="card"
              style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}
            >
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <Link
                  to={link}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'block',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {route.slug}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
                    {formatNumber(route.clicks)} clicks · 7d
                    {stats?.error ? (
                      <span style={{ color: 'var(--error)', marginLeft: 8 }}>Sparkline unavailable</span>
                    ) : null}
                  </div>
                </Link>
                <Sparkline
                  data={sparkData}
                  loading={Boolean(stats?.loading)}
                  width={140}
                  height={36}
                  ariaLabel={`7-day trend for ${route.slug}`}
                />
              </div>
              {shareHref ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <a
                    href={shareHref}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13,
                      color: 'var(--accent)',
                      textDecoration: 'none',
                    }}
                  >
                    Share release
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  const totalClicks = formatNumber(summary?.total_clicks)
  const uniqueRoutes = formatNumber(summary?.unique_routes)
  const topRouteClicks = formatNumber(topRoutes.length ? topRoutes[0].clicks : null)

  const clicksSeries = useMemo(() => buildSparklineSeries(series?.by_day_clicks || [], 7), [series])
  const activeRoutesSeries = useMemo(() => buildSparklineSeries(series?.by_day_active_routes || [], 7), [series])
  const topRouteSparkSeries = useMemo(() => {
    if (!topRoutes.length) return [] as ReturnType<typeof buildSparklineSeries>
    const s = routeStats[topRoutes[0].route_id]
    return buildSparklineSeries(s?.data?.by_day || [], 7)
  }, [routeStats, topRoutes])

  const isAuthenticated = status === 'authenticated'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-lg)' }}>
      <section>
        <div className="heading" style={{ margin: '0 0 12px' }}>7 day traction</div>
        {!isAuthenticated ? (
          <div className="card" style={{ padding: 16 }}>
            <p className="muted" style={{ margin: 0 }}>
              Sign in to view dashboard analytics.
            </p>
          </div>
        ) : (
          <div className="row dashboard__cards">
            <div className="card dashboard__card">
              <div className="dashboard__card-head">
                <div className="dashboard__card-title">Clicks</div>
                <div className="dashboard__card-value">{summaryLoading ? '…' : totalClicks}</div>
              </div>
              <Sparkline data={clicksSeries} loading={seriesLoading} width={160} height={40} ariaLabel="7-day clicks trend" />
            </div>
            <div className="card dashboard__card">
              <div className="dashboard__card-head">
                <div className="dashboard__card-title">Active routes</div>
                <div className="dashboard__card-value">{summaryLoading ? '…' : uniqueRoutes}</div>
              </div>
              <Sparkline data={activeRoutesSeries} loading={seriesLoading} width={160} height={40} ariaLabel="7-day active routes trend" />
            </div>
            <div className="card dashboard__card">
              <div className="dashboard__card-head">
                <div className="dashboard__card-title">Top route hits</div>
                <div className="dashboard__card-value">{summaryLoading ? '…' : topRouteClicks}</div>
              </div>
              <Sparkline data={topRouteSparkSeries} loading={Boolean(topRoutes.length && routeStats[topRoutes[0].route_id]?.loading)} width={160} height={40} ariaLabel="7-day top route trend" />
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="heading" style={{ margin: '0 0 8px' }}>Top routes</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 12px' }}>
          <div className="muted" style={{ fontSize: 13 }}>Filter by UTM source</div>
          <UTMChips
            sources={series?.utm_sources || []}
            loading={seriesLoading}
            limit={4}
            activeSource={activeUTM}
            onSelect={setActiveUTM}
            emptyLabel={seriesError ? `Unable to load UTM sources.` : 'No tracked UTM sources yet.'}
          />
        </div>
        {renderTopRoutes()}
      </section>

      <ToastShelf items={toastItems} onDismiss={removeToast} />
    </div>
  )
}
