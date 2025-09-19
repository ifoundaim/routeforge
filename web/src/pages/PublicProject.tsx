import React, { useEffect, useMemo, useState } from 'react'

import { LicenseBadge, type LicenseCode } from '../components/LicenseStep'
import { apiGet } from '../lib/api'
import { useShareMeta } from '../lib/shareMeta'
import '../styles/public-share.css'
import '../styles/license.css'

const KNOWN_LICENSES: readonly LicenseCode[] = ['MIT', 'Apache-2.0', 'CC-BY-4.0', 'CUSTOM'] as const

type PublicRoute = {
  id: number
  slug: string
  target_url: string
  created_at: string
}

type PublicReleaseSummary = {
  id: number
  version: string
  created_at: string
  license_code?: string | null
  license_custom_text?: string | null
  license_url?: string | null
  latest_route?: PublicRoute | null
}

type PublicProject = {
  id: number
  name: string
  owner?: string | null
  description?: string | null
  created_at: string
  total_releases: number
  recent_releases: PublicReleaseSummary[]
}

type ProjectState = {
  loading: boolean
  error: string | null
  project: PublicProject | null
}

function isKnownLicense(code: string | null | undefined): code is LicenseCode {
  return Boolean(code && KNOWN_LICENSES.includes(code as LicenseCode))
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const value = new Date(iso)
    if (Number.isNaN(value.getTime())) return iso
    return value.toLocaleDateString(undefined, { dateStyle: 'medium' })
  } catch {
    return iso
  }
}

function summarizeProject(project: PublicProject | null): string | null {
  if (!project) return null
  const parts: string[] = []
  if (project.total_releases > 0) {
    parts.push(`${project.total_releases} release${project.total_releases === 1 ? '' : 's'}`)
  }
  if (project.owner) {
    parts.push(`maintained by ${project.owner}`)
  }
  if (project.recent_releases?.length) {
    const latest = project.recent_releases[0]
    parts.push(`latest v${latest.version}`)
  }
  return parts.length ? parts.join(' • ') : 'RouteForge project overview.'
}

function renderLicenseBadge(code: string | null | undefined): React.ReactNode {
  if (!code) return <span className="muted">No license</span>
  if (isKnownLicense(code)) {
    return <LicenseBadge code={code} />
  }
  const modifier = code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'custom'
  return (
    <span
      className="license-badge"
      style={{
        background: 'rgba(148, 163, 184, 0.18)',
        border: '1px solid rgba(148, 163, 184, 0.4)',
        color: 'inherit',
      }}
      data-license={modifier}
    >
      {code}
    </span>
  )
}

export function PublicProject() {
  const projectId = useMemo(() => {
    const parts = window.location.pathname.split('/').filter(Boolean)
    const maybe = parts[parts.length - 1]
    const parsed = Number.parseInt(maybe || '', 10)
    return Number.isFinite(parsed) ? parsed : null
  }, [])

  const [state, setState] = useState<ProjectState>({ loading: true, error: null, project: null })

  useEffect(() => {
    if (projectId == null) {
      setState({ loading: false, error: 'Project id not found in URL.', project: null })
      return
    }

    let alive = true
    setState(current => ({ ...current, loading: true, error: null }))
    apiGet<PublicProject>(`/public/projects/${projectId}`)
      .then(data => {
        if (!alive) return
        setState({ loading: false, error: null, project: data })
      })
      .catch(err => {
        if (!alive) return
        const message = err instanceof Error ? err.message : 'Unable to load project.'
        setState({ loading: false, error: message, project: null })
      })
    return () => {
      alive = false
    }
  }, [projectId])

  const { loading, error, project } = state
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const url = typeof window !== 'undefined' ? window.location.href : undefined
  const ogImage = project ? `${origin}/og/project/${project.id}.png` : undefined
  const title = project ? `RouteForge • ${project.name}` : 'RouteForge • Project overview'
  const description = project?.description?.trim() || summarizeProject(project)

  useShareMeta({ title, description, image: ogImage, url })

  return (
    <div className="public-shell">
      <header className="public-shell__header">
        <a className="public-shell__brand" href="/">RouteForge</a>
      </header>
      <main className="public-shell__main">
        <div className="public-shell__container">
          <article className="public-card" aria-live="polite">
            {loading ? (
              <div>
                <div className="public-placeholder public-placeholder--title" />
                <div className="public-placeholder public-placeholder--text" style={{ marginTop: 12 }} />
                <div className="public-placeholder" style={{ marginTop: 18, width: '80%' }} />
              </div>
            ) : error ? (
              <div className="public-error" role="alert">{error}</div>
            ) : project ? (
              <>
                <div className="public-release__meta">
                  <div>
                    <h1 className="public-release__title" style={{ fontSize: 32 }}>{project.name}</h1>
                    <p className="public-release__subtitle">
                      {project.owner ? `Maintained by ${project.owner}` : 'RouteForge project'}
                      {' '}
                      • Created {formatDate(project.created_at)}
                    </p>
                  </div>
                  <div className="public-release__badges" style={{ justifyContent: 'flex-end' }}>
                    <span className="chip">{project.total_releases} release{project.total_releases === 1 ? '' : 's'}</span>
                  </div>
                </div>

                {project.description ? (
                  <p className="public-release__notes" style={{ marginTop: 18 }}>{project.description}</p>
                ) : (
                  <p className="public-release__notes" style={{ marginTop: 18, color: 'var(--muted)' }}>
                    No public description provided for this project.
                  </p>
                )}

                <div className="public-section">
                  <h2 className="public-section__title">Recent releases</h2>
                  {project.recent_releases?.length ? (
                    <ul className="public-section__list">
                      {project.recent_releases.map(release => {
                        const shareHref = `/rel/${release.id}`
                        const route = release.latest_route?.slug ? `/r/${release.latest_route.slug}` : null
                        return (
                          <li key={release.id} className="public-release-list__item">
                            <div className="public-release-list__meta">
                              <span className="public-release-list__version">v{release.version}</span>
                              <span className="public-release-list__date">Published {formatDate(release.created_at)}</span>
                              <div className="public-release__badges" style={{ gap: 10 }}>
                                {renderLicenseBadge(release.license_code)}
                                {route ? (
                                  <a className="public-link" href={route} target="_blank" rel="noreferrer">
                                    {route}
                                  </a>
                                ) : (
                                  <span className="muted">No route minted</span>
                                )}
                              </div>
                            </div>
                            <div className="public-release-list__actions">
                              <a className="public-button public-button--secondary" href={shareHref}>
                                View release
                              </a>
                              {route ? (
                                <a className="public-button public-button--secondary" href={route} target="_blank" rel="noreferrer">
                                  Visit route
                                </a>
                              ) : null}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="public-empty">No releases have been published for this project yet.</div>
                  )}
                </div>
              </>
            ) : null}
          </article>
        </div>
      </main>
      <footer className="public-shell__footer">
        © {new Date().getFullYear()} RouteForge — Share projects and releases with provenance.
      </footer>
    </div>
  )
}

export default PublicProject
