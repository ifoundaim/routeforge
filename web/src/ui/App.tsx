import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { UpgradeModal } from '../features/billing/UpgradeModal'
import { useEntitlements } from '../features/billing/useEntitlements'
import { Header } from '../components/Header'
import { AppLayout } from '../pages/AppLayout'
import { Dashboard } from '../pages/Dashboard'
import { RouteDetail as RouteDetailPage } from '../pages/RouteDetail'
import { SettingsWebhooks } from '../pages/SettingsWebhooks'

type Json = Record<string, unknown>

const API_BASE = '' // use Vite proxy

async function http<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: { 'content-type': 'application/json', ...(opts?.headers || {}) },
    ...opts,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `${res.status}`
    throw new Error(msg)
  }
  return data as T
}

// API types based on backend schemas
type ProjectOut = { id: number; name: string; owner: string; description?: string | null; created_at: string }
type ReleaseOut = {
  id: number
  project_id: number
  version: string
  notes?: string | null
  artifact_url: string
  artifact_sha256?: string | null
  created_at: string
}
type ReleaseDetailOut = ReleaseOut & { project: ProjectOut; latest_route?: RouteOut | null }
type RouteOut = { id: number; project_id: number; slug: string; target_url: string; release_id?: number | null; created_at: string }
type RouteHit = { id: number; ts: string; ip?: string | null; ua?: string | null; ref?: string | null }

// Minimal toast impl
function useToast() {
  const [toasts, setToasts] = useState<{ id: number; text: string; kind?: 'error' | 'ok' }[]>([])
  const idRef = useRef(1)
  const push = (text: string, kind?: 'error' | 'ok') => {
    const id = idRef.current++
    setToasts(t => [...t, { id, text, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }
  const view = (
    <div>
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind || ''}`}>{t.text}</div>
      ))}
    </div>
  )
  return { push, view }
}

function CopyButton({ text, onCopied }: { text: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <button className="ghost" onClick={async () => {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      onCopied?.()
      setTimeout(() => setCopied(false), 1000)
    }}>{copied ? 'Copied' : 'Copy'}</button>
  )
}

function AppRootRedirect() {
  const location = useLocation()
  const search = location.search || ''
  return <Navigate to={`/app/dashboard${search}`} replace />
}

export function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/app/dashboard" element={<Dashboard />} />
          <Route path="/app/settings/webhooks" element={<SettingsWebhooks />} />
          <Route path="/app/routes/:slug" element={<RouteDetailPage />} />
          <Route path="/app/routes/id/:id" element={<RouteDetailPage />} />
          <Route path="/app/setup" element={<LegacyDemoApp />} />
          <Route path="/app" element={<AppRootRedirect />} />
          <Route path="*" element={<AppRootRedirect />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}

function SpinnerInline() { return <span className="spinner" /> }

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="heading">{title}</div>
        <div>{right}</div>
      </div>
      {children}
    </div>
  )
}

// Theme toggle
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
  const cycle = () => setPref(pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system')
  const label = pref === 'system' ? 'System' : pref === 'light' ? 'Light' : 'Dark'
  return <button className="ghost" onClick={cycle} title="Theme">Theme: {label}</button>
}

// Relative time formatter
function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000))
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

// Wizard Steps
function CreateProjectStep({ onCreated }: { onCreated: (p: ProjectOut) => void }) {
  const { push } = useToast()
  const [form, setForm] = useState({ name: '', owner: '', description: '' })
  const [loading, setLoading] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const p = await http<ProjectOut>('/api/projects', { method: 'POST', body: JSON.stringify(form) })
      push('Project created', 'ok')
      onCreated(p)
    } catch (e: any) {
      push(`Project error: ${e.message}`, 'error')
    } finally { setLoading(false) }
  }
  return (
    <form onSubmit={submit} className="row">
      <input placeholder="Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      <input placeholder="Owner" required value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} />
      <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      <button className="primary" disabled={loading}>{loading ? <SpinnerInline /> : 'Create project'}</button>
    </form>
  )
}

function CreateReleaseStep({ project, onCreated }: { project: ProjectOut, onCreated: (r: ReleaseOut) => void }) {
  const { push } = useToast()
  const [form, setForm] = useState({ version: '', artifact_url: '', notes: '' })
  const [loading, setLoading] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { project_id: project.id, version: form.version, artifact_url: form.artifact_url, notes: form.notes || undefined }
      const r = await http<ReleaseOut>('/api/releases', { method: 'POST', body: JSON.stringify(payload) })
      push('Release created', 'ok')
      onCreated(r)
    } catch (e: any) {
      push(`Release error: ${e.message}`, 'error')
    } finally { setLoading(false) }
  }
  return (
    <form onSubmit={submit} className="row">
      <input placeholder="Version (e.g. 1.2.3)" required value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} />
      <input placeholder="Artifact URL" required value={form.artifact_url} onChange={e => setForm({ ...form, artifact_url: e.target.value })} />
      <input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
      <button className="primary" disabled={loading}>{loading ? <SpinnerInline /> : 'Create release'}</button>
    </form>
  )
}

function CreateRouteStep({ project, release, onCreated }: { project: ProjectOut, release?: ReleaseOut | null, onCreated: (r: RouteOut) => void }) {
  const { push } = useToast()
  const [form, setForm] = useState({ slug: '', target_url: release?.artifact_url || '' })
  const [loading, setLoading] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload: Json = { project_id: project.id, slug: form.slug, target_url: form.target_url }
      if (release) payload.release_id = release.id
      const r = await http<RouteOut>('/api/routes', { method: 'POST', body: JSON.stringify(payload) })
      push('Route created', 'ok')
      onCreated(r)
    } catch (e: any) {
      push(`Route error: ${e.message}`, 'error')
    } finally { setLoading(false) }
  }
  return (
    <form onSubmit={submit} className="row">
      <input placeholder="Slug (unique)" required value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} />
      <input placeholder="Target URL" required value={form.target_url} onChange={e => setForm({ ...form, target_url: e.target.value })} />
      <button className="primary" disabled={loading}>{loading ? <SpinnerInline /> : 'Create route'}</button>
    </form>
  )
}

function HitsChip({ routeId }: { routeId: number }) {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await http<{ count: number }>(`/api/routes/${routeId}/hits`)
        if (alive) setCount(r.count)
      } catch { /* ignore */ }
    }
    load()
    const t = setInterval(load, 3000)
    return () => { alive = false; clearInterval(t) }
  }, [routeId])
  return <span className="chip hits">Hits: {count == null ? '—' : count}</span>
}

function RoutesTable({
  routes,
  isPro,
  onActiveRoute,
  onShowDetail,
  onCopied,
  onRequirePro,
}: {
  routes: RouteOut[]
  isPro: boolean
  onActiveRoute?: (url: string) => void
  onShowDetail?: (r: RouteOut) => void
  onCopied?: () => void
  onRequirePro: () => void
}) {
  const base = `${window.location.origin}/r/`
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Slug</th>
            <th>URL</th>
            <th>Hits</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {routes.map(r => {
            const url = `${base}${r.slug}`
            return (
              <tr key={r.id} onMouseEnter={() => onActiveRoute?.(url)}>
                <td><code>{r.slug}</code></td>
                <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.target_url}</td>
                <td><HitsChip routeId={r.id} /></td>
                <td className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  {isPro ? (
                    <button onClick={() => onShowDetail?.(r)}>Details</button>
                  ) : (
                    <button className="ghost" onClick={onRequirePro} title="Upgrade to view route details">
                      🔒 Upgrade
                    </button>
                  )}
                  <CopyButton text={url} onCopied={onCopied} />
                  <a href={url} target="_blank" rel="noreferrer">
                    <button>Open</button>
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function LegacyRouteDetail({ route, onClose, isPro, onRequirePro }: { route: RouteOut; onClose: () => void; isPro: boolean; onRequirePro: () => void }) {
  const [hits, setHits] = useState<RouteHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await http<{ hits: RouteHit[] }>(`/api/routes/${route.id}/hits/recent?limit=20`)
      setHits(res.hits)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [route.id])

  const base = `${window.location.origin}/r/${route.slug}`
  const exportUrl = `/api/routes/${route.id}/export.csv`

  return (
    <Section title={`Route detail: ${route.slug}`} right={<button className="ghost" onClick={onClose}>Back</button>}>
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        <span className="muted">Target</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{route.target_url}</span>
        <div style={{ flex: 1 }} />
        {isPro ? (
          <a href={exportUrl}><button>Export CSV</button></a>
        ) : (
          <button className="ghost" onClick={onRequirePro} title="Upgrade to export CSV">
            🔒 Upgrade
          </button>
        )}
        <a href={base} target="_blank" rel="noreferrer"><button>Open</button></a>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div className="heading" style={{ margin: 0 }}>Recent hits</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="ghost" onClick={load} disabled={loading}>{loading ? <SpinnerInline /> : 'Refresh'}</button>
        </div>
      </div>
      {error && <div className="muted">Error: {error}</div>}
      {!error && (
        hits == null && loading ? (
          <div className="muted">Loading…</div>
        ) : hits && hits.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {hits.map(h => (
              <li key={h.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #1f2937' }}>
                <span className="chip" style={{ minWidth: 68, justifyContent: 'center' }}>{formatRelativeTime(h.ts)}</span>
                <span className="muted" style={{ minWidth: 80 }}>{h.ip || '—'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.ref || h.ua || '—'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted">No hits yet. Share your route URL and check back.</div>
        )
      )}
    </Section>
  )
}

function LegacyDemoApp() {
  const toast = useToast()
  const { pro, loading: entitlementsLoading, upgradeToPro, upgrading } = useEntitlements()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [project, setProject] = useState<ProjectOut | null>(null)
  const [release, setRelease] = useState<ReleaseOut | null>(null)
  const [routes, setRoutes] = useState<RouteOut[]>([])
  const [selectedRoute, setSelectedRoute] = useState<RouteOut | null>(null)
  const [activeCopyUrl, setActiveCopyUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!pro) {
      setSelectedRoute(null)
    }
  }, [pro])

  // Keep routes list by pulling from release detail (to get latest_route) when release changes
  useEffect(() => {
    const loadReleaseDetail = async () => {
      if (!release?.id) return
      try {
        const detail = await http<ReleaseDetailOut>(`/api/releases/${release.id}`)
        const maybe = detail.latest_route ? [detail.latest_route] : []
        setRoutes(maybe)
      } catch (e: any) {
        toast.push(`Release detail error: ${e.message}`, 'error')
      }
    }
    loadReleaseDetail()
  }, [release?.id])

  const resetAll = () => { setProject(null); setRelease(null); setRoutes([]); setSelectedRoute(null) }

  const openUpgrade = () => setUpgradeOpen(true)

  const handleUpgrade = async () => {
    try {
      const upgraded = await upgradeToPro(true)
      if (upgraded) {
        toast.push('Pro unlocked', 'ok')
      } else {
        toast.push('Pro already active', 'ok')
      }
      setUpgradeOpen(false)
    } catch (e: any) {
      const message = e?.message ? String(e.message) : 'Unable to upgrade'
      toast.push(`Upgrade failed: ${message}`, 'error')
    }
  }

  useEffect(() => {
    if (pro && upgradeOpen) {
      setUpgradeOpen(false)
    }
  }, [pro, upgradeOpen])

  const planLabel = entitlementsLoading ? 'Plan: ...' : pro ? 'Plan: Pro' : 'Plan: Free'

  const upgradeButtonLabel = upgrading ? 'Upgrading...' : 'Upgrade'

  // Keyboard copy: press 'c' to copy last active route URL
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const key = (e.key || '').toLowerCase()
      if (key !== 'c' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable)) return
      if (activeCopyUrl) {
        try {
          await navigator.clipboard.writeText(activeCopyUrl)
          toast.push('Copied route URL', 'ok')
        } catch { /* ignore */ }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeCopyUrl])

  return (
    <>
      <Header />
      <main className="container">
        <div className="row" style={{ alignItems: 'center', gap: 'var(--space-3)' }}>
          <h1 style={{ margin: 0 }}>RouteForge</h1>
          <span className="muted">Demo SPA</span>
          <div style={{ flex: 1 }} />
          <div className="present-hidden">
            <ThemeToggle />
          </div>
          <span
            className="chip present-hidden"
            style={{
              backgroundColor: pro ? 'var(--color-brand)' : 'rgba(148, 163, 184, 0.15)',
              color: 'var(--color-text-strong)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {planLabel}
          </span>
          {!pro && (
            <button className="primary present-hidden" onClick={openUpgrade} disabled={upgrading}>
              {upgradeButtonLabel}
            </button>
          )}
          <button type="button" className="ghost present-hidden" onClick={resetAll}>Reset</button>
        </div>

        <Section title="1) Create project" right={<span className="muted">Step 1</span>}>
          {project ? (
            <div className="row" style={{ alignItems: 'center' }}>
              <span className="chip">{project.name}</span>
              <span className="muted">owner: {project.owner}</span>
            </div>
          ) : (
            <CreateProjectStep onCreated={setProject} />
          )}
        </Section>

        <Section title="2) Create release" right={!project ? <span className="muted">Waiting for project</span> : <span className="muted">Step 2</span>}>
          {project ? (
            release ? (
              <div className="row" style={{ alignItems: 'center' }}>
                <span className="chip">v{release.version}</span>
                <a href={release.artifact_url} target="_blank" rel="noreferrer"><button>Artifact</button></a>
              </div>
            ) : (
              <CreateReleaseStep project={project} onCreated={setRelease} />
            )
          ) : (
            <div className="muted">No project yet. Create a project to continue.</div>
          )}
        </Section>

        {selectedRoute && pro ? (
          <LegacyRouteDetail
            route={selectedRoute}
            onClose={() => setSelectedRoute(null)}
            isPro={pro}
            onRequirePro={openUpgrade}
          />
        ) : (
          <Section title="3) Create route" right={!project ? <span className="muted">Waiting for project</span> : !release ? <span className="muted">Optional: link release</span> : undefined}>
            {project ? (
              routes.length ? (
                <RoutesTable
                  routes={routes}
                  isPro={pro}
                  onActiveRoute={setActiveCopyUrl}
                  onShowDetail={setSelectedRoute}
                  onCopied={() => toast.push('Copied route URL', 'ok')}
                  onRequirePro={openUpgrade}
                />
              ) : (
                <CreateRouteStep project={project} release={release} onCreated={(r) => setRoutes([r])} />
              )
            ) : (
              <div className="muted">No project yet. Create a project to start.</div>
            )}
          </Section>
        )}
      </main>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onUpgrade={handleUpgrade}
        upgrading={upgrading}
      />
      {toast.view}
    </>
  )
}
