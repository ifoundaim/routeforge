import React from 'react'
import { ImageResponse } from '@vercel/og'

export const config = { runtime: 'edge' }

type ReactChild = Parameters<typeof React.createElement>[2]

type PublicRoute = {
  slug?: string | null
}

type PublicRelease = {
  id: number
  version: string
  notes?: string | null
  project: { name: string }
  license_code?: string | null
  latest_route?: PublicRoute | null
}

type PublicProject = {
  id: number
  name: string
  owner?: string | null
  total_releases: number
  recent_releases: { id: number; version: string }[]
}

const WIDTH = 1200
const HEIGHT = 630

const LICENSE_LABELS: Record<string, string> = {
  MIT: 'MIT',
  'Apache-2.0': 'Apache 2.0',
  'CC-BY-4.0': 'CC BY 4.0',
  CUSTOM: 'Custom License',
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function formatReleaseDescription(release: PublicRelease): string {
  if (release.notes) {
    const compact = release.notes.replace(/\s+/g, ' ').trim()
    if (compact.length > 140) return `${compact.slice(0, 137)}…`
    if (compact.length > 0) return compact
  }
  const projectName = release.project?.name || 'RouteForge project'
  const route = release.latest_route?.slug
  if (route) return `${projectName} release v${release.version} • Route /r/${route}`
  return `${projectName} release v${release.version}`
}

function resolveLicense(code?: string | null): string {
  if (!code) return 'No license set'
  return LICENSE_LABELS[code] || code
}

function view(node: ReactChild, props?: Record<string, unknown>) {
  return React.createElement('div', props ?? {}, node)
}

function buildReleaseImage(release: PublicRelease) {
  const description = formatReleaseDescription(release)
  const licenseLabel = resolveLicense(release.license_code)
  const routeSlug = release.latest_route?.slug ? `/r/${release.latest_route.slug}` : 'Route mint pending'

  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background:
          'radial-gradient(circle at 20% 20%, rgba(59,130,246,0.25), transparent 55%), linear-gradient(135deg, #0b1120 0%, #111827 55%, #1e293b 100%)',
        color: '#e2e8f0',
        padding: '64px 72px',
        fontFamily: 'Inter, sans-serif',
      },
    },
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
        view('RouteForge Release', {
          style: {
            fontSize: 28,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#60a5fa',
            fontWeight: 600,
          },
        }),
        view(`v${release.version}`, { style: { fontSize: 54, fontWeight: 700 } }),
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 24 } },
        view(release.project?.name || 'RouteForge', {
          style: { fontSize: 64, fontWeight: 700, maxWidth: 840 },
        }),
        view(description, {
          style: { fontSize: 30, lineHeight: 1.35, color: 'rgba(226,232,240,0.92)', maxWidth: 880 },
        }),
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' } },
        view(
          React.createElement(
            React.Fragment,
            null,
            view('License', {
              style: {
                fontSize: 18,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#94a3b8',
              },
            }),
            view(licenseLabel, { style: { fontSize: 32, fontWeight: 600 } }),
          ),
          { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        ),
        view(
          React.createElement(
            React.Fragment,
            null,
            view('Route', {
              style: {
                fontSize: 18,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#94a3b8',
              },
            }),
            view(routeSlug, { style: { fontSize: 32, fontWeight: 600 } }),
          ),
          { style: { display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'right' } },
        ),
      ),
    ),
  )
}

function buildProjectImage(project: PublicProject) {
  const latest = project.recent_releases?.[0]
  const stats = `${project.total_releases} release${project.total_releases === 1 ? '' : 's'}`
  const subtitleParts: string[] = [stats]
  if (project.owner) subtitleParts.push(`maintained by ${project.owner}`)
  if (latest) subtitleParts.push(`latest v${latest.version}`)

  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background:
          'radial-gradient(circle at 80% 20%, rgba(59,130,246,0.25), transparent 55%), linear-gradient(140deg, #0f172a 0%, #1e293b 55%, #111827 100%)',
        color: '#e2e8f0',
        padding: '64px 72px',
        fontFamily: 'Inter, sans-serif',
      },
    },
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
        view('RouteForge Project', {
          style: {
            fontSize: 28,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#60a5fa',
            fontWeight: 600,
          },
        }),
        view(subtitleParts.join(' • '), { style: { fontSize: 26, color: 'rgba(148,163,184,0.85)' } }),
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 24 } },
        view(project.name, { style: { fontSize: 68, fontWeight: 700, maxWidth: 860 } }),
        project.owner
          ? view(`Maintained by ${project.owner}`, {
              style: { fontSize: 32, color: 'rgba(226,232,240,0.92)' },
            })
          : null,
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' } },
        view(
          React.createElement(
            React.Fragment,
            null,
            view('Releases', {
              style: {
                fontSize: 18,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#94a3b8',
              },
            }),
            view(project.total_releases, { style: { fontSize: 38, fontWeight: 700 } }),
          ),
          { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        ),
        latest
          ? view(
              React.createElement(
                React.Fragment,
                null,
                view('Latest', {
                  style: {
                    fontSize: 18,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                  },
                }),
                view(`v${latest.version}`, { style: { fontSize: 32, fontWeight: 600 } }),
              ),
              { style: { display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'right' } },
            )
          : view('Awaiting first release', {
              style: { fontSize: 24, color: 'rgba(148,163,184,0.75)' },
            }),
      ),
    ),
  )
}

function fallbackImage(message: string) {
  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #111827 100%)',
        color: '#e2e8f0',
        fontSize: 36,
        fontFamily: 'Inter, sans-serif',
        letterSpacing: '0.05em',
      },
    },
    message,
  )
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\.png$/i, '')
  const segments = pathname.split('/').filter(Boolean)

  let kind: 'release' | 'project' | null = null
  let id: number | null = null

  if (segments.length >= 3 && segments[0] === 'og') {
    const maybeKind = segments[1]
    if (maybeKind === 'release' || maybeKind === 'project') {
      kind = maybeKind
      const rawId = parseInt(segments[2], 10)
      if (Number.isFinite(rawId)) {
        id = rawId
      }
    }
  }

  if (id == null) {
    const releaseId = url.searchParams.get('release') || url.searchParams.get('release_id')
    const projectId = url.searchParams.get('project') || url.searchParams.get('project_id')
    if (releaseId) {
      kind = 'release'
      const parsed = parseInt(releaseId, 10)
      if (Number.isFinite(parsed)) id = parsed
    } else if (projectId) {
      kind = 'project'
      const parsed = parseInt(projectId, 10)
      if (Number.isFinite(parsed)) id = parsed
    }
  }

  if (!kind || id == null || !Number.isFinite(id)) {
    return new ImageResponse(fallbackImage('RouteForge share'), {
      width: WIDTH,
      height: HEIGHT,
      headers: { 'cache-control': 'public, max-age=3600, s-maxage=3600' },
      status: 400,
    })
  }

  const origin = `${url.protocol}//${url.host}`

  if (kind === 'release') {
    const release = await fetchJson<PublicRelease>(`${origin}/public/releases/${id}`)
    if (!release) {
      return new ImageResponse(fallbackImage('Release not found'), {
        width: WIDTH,
        height: HEIGHT,
        headers: { 'cache-control': 'public, max-age=300, s-maxage=300' },
        status: 404,
      })
    }
    return new ImageResponse(buildReleaseImage(release), {
      width: WIDTH,
      height: HEIGHT,
      headers: { 'cache-control': 'public, max-age=3600, s-maxage=3600' },
    })
  }

  const project = await fetchJson<PublicProject>(`${origin}/public/projects/${id}`)
  if (!project) {
    return new ImageResponse(fallbackImage('Project not found'), {
      width: WIDTH,
      height: HEIGHT,
      headers: { 'cache-control': 'public, max-age=300, s-maxage=300' },
      status: 404,
    })
  }

  return new ImageResponse(buildProjectImage(project), {
    width: WIDTH,
    height: HEIGHT,
    headers: { 'cache-control': 'public, max-age=3600, s-maxage=3600' },
  })
}
