import React, { useEffect } from 'react'

import { CTAButton } from '../components/CTAButton'
import { FlowDiagram } from '../components/FlowDiagram'
import { Header } from '../components/Header'
import { useShareMeta } from '../lib/shareMeta'
import '../styles/landing.css'

export function Landing() {
  useShareMeta({
    title: 'RouteForge – Ship releases, mint links, prove authorship.',
    description:
      'RouteForge ships releases by agent: one request mints links, proves authorship, and routes traffic with TiDB-backed evidence.',
  })

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    document.body.classList.add('landing-page')

    return () => {
      document.body.classList.remove('landing-page')
    }
  }, [])

  return (
    <div className="landing">
      <Header />

      <main className="landing-main" id="main" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-content">
            <p className="landing-eyebrow">Agent-native release routing</p>
            <h1 id="landing-title">Ship releases, mint links, prove authorship — by an agent.</h1>
            <p className="landing-subtitle">One request → Release + Route + Evidence + Attest. Backed by TiDB.</p>

            <div className="landing-cta-group" role="group" aria-label="Primary actions">
              <CTAButton href="/app" variant="primary" aria-label="Open the RouteForge web app">Open App</CTAButton>
              <CTAButton
                href="/openapi.json"
                variant="secondary"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View the RouteForge OpenAPI definition in a new tab"
              >
                View API
              </CTAButton>
            </div>

            <p className="landing-hero-note">
              The RouteForge agent captures releases, routes 302s, and writes immutable evidence directly to TiDB. Watch the flow below.
            </p>
          </div>

          <a
            className="landing-hero-video"
            href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Placeholder video slot: watch the RouteForge agent flow"
          >
            <div className="landing-hero-video-inner">
              <span className="landing-hero-video-label">Video slot</span>
              <span className="landing-hero-video-title">See the agent capture a release</span>
              <span className="landing-hero-video-meta">2:04 &bull; Loom / YouTube ready</span>
            </div>
          </a>
        </section>

        <section className="landing-section landing-diagram" aria-labelledby="agent-flow-title">
          <div className="landing-diagram-header">
            <h2 id="agent-flow-title">Agent proof in five clean steps</h2>
            <p>Every release request is orchestrated, previewed, and evidenced without leaving your stack.</p>
          </div>
          <FlowDiagram />
        </section>

        <section className="landing-section" aria-labelledby="why-tidb">
          <h2 id="why-tidb">Why TiDB backs the evidence</h2>
          <ul className="landing-list">
            <li>Elastic MySQL surface that scales with launch days</li>
            <li>HTAP design gives click-thru stats without replicas</li>
            <li>One DSN, zero babysitting — infra stays invisible</li>
          </ul>
        </section>
      </main>

      <footer className="landing-footer">
        <small>© {new Date().getFullYear()} RouteForge · Built on TiDB</small>
        <div className="landing-footer-links">
          <a href="https://github.com/ifoundaim/routeforge" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://github.com/ifoundaim/routeforge/tree/main/docs" target="_blank" rel="noopener noreferrer">Docs</a>
        </div>
      </footer>
    </div>
  )
}
