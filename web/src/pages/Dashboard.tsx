import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Header } from '../components/Header'
import { Sparkline, buildSparklineSeries } from '../components/Sparkline'
import { apiGet } from '../lib/api'
import { useSession } from '../lib/session'

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
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {topRoutes.map(route => {
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

  const isAuthenticated = status === 'authenticated'

  return (
    <div className="container">
      <Header />
      <main style={{ display: 'flex', flexDirection: 'column', gap: 'var(--layout-gap)' }}>
        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="heading" style={{ marginBottom: 0 }}>7 day traction</div>
          {!isAuthenticated ? (
            <p className="muted" style={{ margin: 0 }}>
              Sign in to view dashboard analytics.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 140px', background: 'rgba(37,99,235,0.12)', borderRadius: 10, padding: 16 }}>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Clicks</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{summaryLoading ? '…' : totalClicks}</div>
              </div>
              <div style={{ flex: '1 1 140px', background: 'rgba(17,24,39,0.25)', borderRadius: 10, padding: 16 }}>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Active routes</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{summaryLoading ? '…' : uniqueRoutes}</div>
              </div>
              <div style={{ flex: '1 1 140px', background: 'rgba(34,197,94,0.12)', borderRadius: 10, padding: 16 }}>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Top route hits</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{summaryLoading ? '…' : topRouteClicks}</div>
              </div>
            </div>
          )}
        </section>

        <section>
          <div className="heading" style={{ margin: '0 0 12px' }}>Top routes</div>
          {renderTopRoutes()}
        </section>
      </main>
    </div>
  )
}
