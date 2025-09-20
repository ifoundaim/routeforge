import React, { useEffect, useMemo, useState } from 'react'

import { LicenseBadge, type LicenseCode } from '../components/LicenseStep'
import { apiGet } from '../lib/api'
import { useShareMeta } from '../lib/shareMeta'
import '../styles/public.css'
import '../styles/license.css'

const KNOWN_LICENSES: readonly LicenseCode[] = ['MIT', 'Apache-2.0', 'CC-BY-4.0', 'CUSTOM'] as const

type PublicRoute = {
  id: number
  slug: string
  target_url: string
  created_at: string
}

type PublicProject = {
  id: number
  name: string
  owner?: string | null
  description?: string | null
  created_at: string
}

type PublicRelease = {
  id: number
  version: string
  notes?: string | null
  artifact_url: string
  evidence_ipfs_cid?: string | null
  license_code?: string | null
  license_custom_text?: string | null
  license_url?: string | null
  created_at: string
  project: PublicProject
  latest_route?: PublicRoute | null
}

type ReleaseState = {
  loading: boolean
  error: string | null
  release: PublicRelease | null
}

function isKnownLicense(code: string | null | undefined): code is LicenseCode {
  return Boolean(code && KNOWN_LICENSES.includes(code as LicenseCode))
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Unknown'
  try {
    const value = new Date(iso)
    if (Number.isNaN(value.getTime())) return iso
    return value.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function summarizeNotes(release: PublicRelease | null): string | null {
  if (!release) return null
  const base = release.notes?.trim()
  if (base) {
    const flattened = base.replace(/\s+/g, ' ').trim()
    if (flattened.length > 180) {
      return `${flattened.slice(0, 177)}…`
    }
    return flattened
  }
  if (release.latest_route?.slug) {
    return `Primary route minted at /r/${release.latest_route.slug}.`
  }
  return 'Evidence package and artifact are ready to share from RouteForge.'
}

export function PublicRelease() {
  const releaseId = useMemo(() => {
    const parts = window.location.pathname.split('/').filter(Boolean)
    const maybe = parts[parts.length - 1]
    const parsed = Number.parseInt(maybe || '', 10)
    return Number.isFinite(parsed) ? parsed : null
  }, [])

  const [state, setState] = useState<ReleaseState>({ loading: true, error: null, release: null })

  useEffect(() => {
    if (releaseId == null) {
      setState({ loading: false, error: 'Release id not found in URL.', release: null })
      return
    }

    let alive = true
    setState(current => ({ ...current, loading: true, error: null }))
    apiGet<PublicRelease>(`/public/releases/${releaseId}`)
      .then(data => {
        if (!alive) return
        setState({ loading: false, error: null, release: data })
      })
      .catch(err => {
        if (!alive) return
        const message = err instanceof Error ? err.message : 'Unable to load release.'
        setState({ loading: false, error: message, release: null })
      })
    return () => {
      alive = false
    }
  }, [releaseId])

  const { loading, error, release } = state
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const url = typeof window !== 'undefined' ? window.location.href : undefined
  const ogImage = release ? `${origin}/api/og/release/${release.id}.png` : undefined
  const title = release
    ? `RouteForge • ${release.project.name} v${release.version}`
    : 'RouteForge • Release overview'
  const summary = summarizeNotes(release)
  const releaseLabel = release ? `${release.project.name} v${release.version}` : null
  const description = releaseLabel
    ? summary
      ? `${releaseLabel} — ${summary}`
      : `${releaseLabel} minted on RouteForge with shareable evidence.`
    : 'Browse public releases minted on RouteForge with downloadable evidence packages.'

  useShareMeta({ title, description, image: ogImage, url })

  const licenseView = (() => {
    if (!release?.license_code) {
      return <span className="muted">License not provided</span>
    }
    if (isKnownLicense(release.license_code)) {
      return <LicenseBadge code={release.license_code} />
    }
    const modifier = release.license_code
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
        {release.license_code}
      </span>
    )
  })()

  const licenseAnnotation = (() => {
    if (!release?.license_code) return null
    if (release.license_code === 'CUSTOM' && release.license_custom_text) {
      return <span className="license-preview__text">Custom terms provided with this release.</span>
    }
    if (release.license_url) {
      return (
        <a className="public-link" href={release.license_url} target="_blank" rel="noreferrer">
          View license terms
        </a>
      )
    }
    return null
  })()

  const routeSlug = release?.latest_route?.slug || null
  const routeHref = routeSlug ? `/r/${routeSlug}` : null
  const evidenceIpfsCid = release?.evidence_ipfs_cid?.trim() || null
  const evidenceIpfsUri = evidenceIpfsCid ? `ipfs://${evidenceIpfsCid}` : null
  const evidenceHref = release ? `/public/releases/${release.id}/evidence.zip` : undefined

  return (
    <div className="public-shell">
      <header className="public-shell__header">
        <a className="public-shell__brand" href="/">RouteForge</a>
      </header>
      <main className="public-shell__main" id="main" tabIndex={-1}>
        <div className="public-shell__container">
          <article className="public-card" aria-live="polite">
            {loading ? (
              <div>
                <div className="public-release__meta">
                  <div>
                    <div className="public-placeholder public-placeholder--title" />
                    <div className="public-placeholder public-placeholder--text" style={{ marginTop: 12 }} />
                  </div>
                  <div className="public-placeholder" style={{ width: 120 }} />
                </div>
                <div className="public-placeholder" style={{ marginTop: 22, width: '85%' }} />
                <div className="public-placeholder" style={{ marginTop: 12, width: '72%' }} />
              </div>
            ) : error ? (
              <div className="public-error" role="alert">{error}</div>
            ) : release ? (
              <>
                <div className="public-release__meta">
                  <div>
                    <h1 className="public-release__title">v{release.version}</h1>
                    <p className="public-release__subtitle">
                      <a className="public-link" href={`/p/${release.project.id}`}>
                        {release.project.name}
                      </a>
                      {' '}
                      • Published {formatDateTime(release.created_at)}
                    </p>
                  </div>
                  <div className="public-release__badges">
                    {licenseView}
                    {licenseAnnotation}
                  </div>
                </div>

                <p className="public-release__notes">
                  {release.notes ? release.notes : 'No release notes were captured for this version.'}
                </p>

                <div className="public-actions">
                  {routeHref ? (
                    <a className="public-button public-button--primary" href={routeHref} target="_blank" rel="noreferrer">
                      Open route
                    </a>
                  ) : null}
                  {evidenceIpfsUri ? (
                    <a className="public-button public-button--secondary" href={evidenceIpfsUri} target="_blank" rel="noreferrer">
                      Evidence (IPFS)
                    </a>
                  ) : evidenceHref ? (
                    <a className="public-button public-button--secondary" href={evidenceHref} download data-cta="download-evidence">
                      Download evidence
                    </a>
                  ) : null}
                </div>

                <div className="public-section" aria-label="Release metadata">
                  <h2 className="public-section__title">Release details</h2>
                  <ul className="public-section__list">
                    <li>
                      <strong>Project owner:</strong>{' '}
                      {release.project.owner || '—'}
                    </li>
                    <li>
                      <strong>Artifact:</strong>{' '}
                      <a className="public-link" href={release.artifact_url} target="_blank" rel="noreferrer">
                        {release.artifact_url}
                      </a>
                    </li>
                    {routeHref ? (
                      <li>
                        <strong>Primary route:</strong>{' '}
                        <a className="public-link" href={routeHref} target="_blank" rel="noreferrer">
                          /r/{routeSlug}
                        </a>
                      </li>
                    ) : (
                      <li>
                        <strong>Primary route:</strong> Not minted yet.
                      </li>
                    )}
                  </ul>
                </div>
              </>
            ) : null}
          </article>
        </div>
      </main>
      <footer className="public-shell__footer">
        © {new Date().getFullYear()} RouteForge — Share releases with provenance.
      </footer>
    </div>
  )
}

export default PublicRelease
