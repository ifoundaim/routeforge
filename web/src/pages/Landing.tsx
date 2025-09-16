import React, { useEffect } from 'react'

import { CTAButton } from '../components/CTAButton'
import '../styles/landing.css'

export function Landing() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'RouteForge – Ship releases, share links, see results.'

    const description = 'RouteForge helps you mint shareable release routes backed by TiDB so you can ship, measure, and iterate faster.'
    const meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    const previousDescription = meta?.getAttribute('content') || null
    let createdMeta: HTMLMetaElement | null = null
    if (meta) {
      meta.setAttribute('content', description)
    } else {
      createdMeta = document.createElement('meta')
      createdMeta.name = 'description'
      createdMeta.content = description
      document.head.appendChild(createdMeta)
    }

    document.body.classList.add('landing-page')

    return () => {
      document.body.classList.remove('landing-page')
      document.title = previousTitle
      if (meta && previousDescription !== null) {
        meta.setAttribute('content', previousDescription)
      } else if (meta && previousDescription === null) {
        meta.removeAttribute('content')
      }
      if (createdMeta) {
        document.head.removeChild(createdMeta)
      }
    }
  }, [])

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-brand">
          <a href="/" aria-label="RouteForge home">RouteForge</a>
        </div>
        <nav aria-label="Primary">
          <a className="landing-link" href="https://github.com/ifoundaim/routeforge" target="_blank" rel="noopener noreferrer">Repo</a>
          <a className="landing-link" href="https://github.com/ifoundaim/routeforge/tree/main/docs" target="_blank" rel="noopener noreferrer">Docs</a>
        </nav>
      </header>

      <main className="landing-main" id="main-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <p className="landing-eyebrow">Modern release routing</p>
          <h1 id="landing-title">RouteForge</h1>
          <p className="landing-subtitle">Ship releases, share links, see results.</p>
          <div className="landing-cta-group">
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
        </section>

        <section className="landing-section" aria-labelledby="why-tidb">
          <h2 id="why-tidb">Why TiDB</h2>
          <ul className="landing-list">
            <li>MySQL-compatible, serverless scale</li>
            <li>Fast writes + analytical queries for click stats</li>
            <li>Simple DX: one DSN, zero-ops</li>
          </ul>
        </section>

        <section className="landing-section" aria-labelledby="how-it-works">
          <h2 id="how-it-works">How it works</h2>
          <ol className="landing-flow">
            <li>Create</li>
            <li>Publish (agent)</li>
            <li>Mint Route</li>
            <li>302 Redirect</li>
            <li>Hits &amp; Stats</li>
          </ol>
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
