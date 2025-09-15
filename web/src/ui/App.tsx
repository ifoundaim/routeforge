import React, { useEffect, useMemo, useRef, useState } from 'react'

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
type ReleaseOut = { id: number; project_id: number; version: string; notes?: string | null; artifact_url: string; created_at: string }
type ReleaseDetailOut = ReleaseOut & { project: ProjectOut; latest_route?: RouteOut | null }
type RouteOut = { id: number; project_id: number; slug: string; target_url: string; release_id?: number | null; created_at: string }

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button className="ghost" onClick={async () => {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1000)
    }}>{copied ? 'Copied' : 'Copy'}</button>
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
  return <span className="chip">Hits: {count == null ? '—' : count}</span>
}

function RoutesTable({ routes }: { routes: RouteOut[] }) {
  const base = `${window.location.origin}/r/`
  return (
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
        {routes.map(r => (
          <tr key={r.id}>
            <td><code>{r.slug}</code></td>
            <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.target_url}</td>
            <td><HitsChip routeId={r.id} /></td>
            <td className="row" style={{ justifyContent: 'flex-end' }}>
              <CopyButton text={`${base}${r.slug}`} />
              <a href={`${base}${r.slug}`} target="_blank" rel="noreferrer">
                <button>Open</button>
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function App() {
  const toast = useToast()
  const [project, setProject] = useState<ProjectOut | null>(null)
  const [release, setRelease] = useState<ReleaseOut | null>(null)
  const [routes, setRoutes] = useState<RouteOut[]>([])

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

  const resetAll = () => { setProject(null); setRelease(null); setRoutes([]) }

  return (
    <div className="container">
      <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>RouteForge</h1>
        <span className="muted">Demo SPA</span>
        <div style={{ flex: 1 }} />
        <button className="ghost" onClick={resetAll}>Reset</button>
      </div>

      <Section title="1) Create project">
        {project ? (
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="chip">{project.name}</span>
            <span className="muted">owner: {project.owner}</span>
          </div>
        ) : (
          <CreateProjectStep onCreated={setProject} />
        )}
      </Section>

      <Section title="2) Create release">
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
          <div className="muted">Create a project first.</div>
        )}
      </Section>

      <Section title="3) Create route">
        {project ? (
          routes.length ? (
            <RoutesTable routes={routes} />
          ) : (
            <CreateRouteStep project={project} release={release} onCreated={(r) => setRoutes([r])} />
          )
        ) : (
          <div className="muted">Create a project and release first.</div>
        )}
      </Section>

      {toast.view}
    </div>
  )
}


