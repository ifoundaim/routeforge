import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { Header } from '../components/Header'
import { apiGet } from '../lib/api'
import { useSession } from '../lib/session'
import '../styles/account.css'

type RouteSummary = {
  id: number
  project_id: number
  slug: string
  target_url: string
  created_at: string
}

type ProjectSummary = {
  id: number
  name: string
  owner: string
  description?: string | null
  created_at: string
  routes?: RouteSummary[]
}

type ProjectsPayload = ProjectSummary[] | { projects?: ProjectSummary[] }

function normalizePayload(payload: ProjectsPayload): ProjectSummary[] {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.projects)) return payload.projects
  return []
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

export function Projects() {
  const { status, user } = useSession()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const email = user?.email ? user.email.toLowerCase() : null

  useEffect(() => {
    if (status !== 'authenticated') {
      setProjects([])
      setLoading(false)
      setError(null)
    }
  }, [status])

  const enrichProject = useCallback(async (project: ProjectSummary): Promise<ProjectSummary> => {
    if (Array.isArray(project.routes)) {
      return { ...project, routes: [...project.routes] }
    }
    try {
      const routes = await apiGet<RouteSummary[]>(`/api/projects/${project.id}/routes`)
      return { ...project, routes }
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      const lower = message.toLowerCase()
      if (
        lower.includes('not_found') ||
        lower.includes('auth_required') ||
        lower.includes('unauthorized')
      ) {
        return { ...project, routes: [] }
      }
      throw err
    }
  }, [])

  const loadProjects = useCallback(async () => {
    if (status !== 'authenticated') return
    setLoading(true)
    setError(null)

    const attempts = new Map<string, true>()
    if (email) {
      attempts.set(`/api/projects?owner=${encodeURIComponent(email)}&include=routes`, true)
      attempts.set(`/api/projects?owner=${encodeURIComponent(email)}&with_routes=1`, true)
      attempts.set(`/api/projects?owner=${encodeURIComponent(email)}`, true)
    }
    attempts.set('/api/projects?include=routes', true)
    attempts.set('/api/projects?with_routes=1', true)
    attempts.set('/api/projects', true)

    let lastError: string | null = null
    for (const path of attempts.keys()) {
      try {
        const payload = await apiGet<ProjectsPayload>(path)
        let items = normalizePayload(payload)
        if (email) {
          items = items.filter(project => (project.owner || '').toLowerCase() === email)
        }
        const enriched = await Promise.all(items.map(enrichProject))
        setProjects(enriched)
        setError(null)
        setLoading(false)
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to load projects'
        const lower = message.toLowerCase()
        if (lower.includes('auth_required') || lower.includes('unauthorized')) {
          setProjects([])
          setError(null)
          setLoading(false)
          return
        }
        if (lower.includes('not_found')) {
          setProjects([])
          setError(null)
          setLoading(false)
          return
        }
        lastError = message
      }
    }

    setProjects([])
    setError(lastError || 'Unable to load projects')
    setLoading(false)
  }, [status, email, enrichProject])

  useEffect(() => {
    if (status === 'authenticated') {
      void loadProjects()
    }
  }, [status, email, loadProjects])

  const hasProjects = useMemo(() => projects.length > 0, [projects])

  const openSignIn = () => {
    window.dispatchEvent(new CustomEvent('routeforge:open-auth'))
  }

  const body = () => {
    if (status === 'loading') {
      return <p className="projects-status">Checking your session…</p>
    }

    if (status === 'unauthenticated') {
      return (
        <div className="projects-empty" role="status">
          <h1>RouteForge Projects</h1>
          <p>Sign in to view the projects and routes associated with your account.</p>
          <button type="button" className="projects-signin" onClick={openSignIn}>
            Sign in
          </button>
        </div>
      )
    }

    if (status === 'error') {
      return (
        <div className="projects-error" role="alert">
          <p>We could not verify your session. Try refreshing the page.</p>
        </div>
      )
    }

    return (
      <section className="projects-section" aria-live="polite">
        <div className="projects-header">
          <h1>My Projects</h1>
          <div className="projects-header__actions">
            <button type="button" className="projects-refresh" onClick={loadProjects} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <a href="/app" className="projects-create">Create project</a>
          </div>
        </div>
        {error ? (
          <div className="projects-error" role="alert">
            <p>{error}</p>
          </div>
        ) : null}
        {!error && !hasProjects && !loading ? (
          <div className="projects-empty" role="status">
            <p>You have not created any projects yet.</p>
            <a href="/app" className="projects-create">Create your first project</a>
          </div>
        ) : null}
        {!error && hasProjects ? (
          <div className="projects-grid">
            {projects.map(project => {
              const routes = project.routes || []
              return (
                <article key={project.id} className="project-card">
                  <header className="project-card__header">
                    <h2>{project.name}</h2>
                    <p className="project-card__meta">
                      <span title={`Project created ${formatDate(project.created_at)}`}>
                        Created {formatDate(project.created_at)}
                      </span>
                    </p>
                    {project.description ? (
                      <p className="project-card__description">{project.description}</p>
                    ) : null}
                  </header>
                  <div className="project-card__routes">
                    <h3>Routes</h3>
                    {routes.length ? (
                      <ul className="routes-list">
                        {routes.map(route => (
                          <li key={route.id} className="routes-list__item">
                            <div className="routes-list__slug">
                              <span className="routes-list__label">Slug</span>
                              <code>{route.slug}</code>
                            </div>
                            <div className="routes-list__target">
                              <span className="routes-list__label">Target</span>
                              <a href={route.target_url} target="_blank" rel="noreferrer">
                                {route.target_url}
                              </a>
                            </div>
                            <time className="routes-list__date" dateTime={route.created_at}>
                              {formatDate(route.created_at)}
                            </time>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="project-card__empty">No routes yet.</p>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <div className="projects-page">
      <Header />
      <main className="projects-main" id="main-content">
        {body()}
      </main>
    </div>
  )
}
