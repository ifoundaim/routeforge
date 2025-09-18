import React, { useEffect, useMemo, useRef, useState } from 'react'

import { DemoBadge } from '../components/DemoBadge'
import { LicenseBadge, type LicenseCode } from '../components/LicenseStep'
import { ProvenanceModal } from '../components/ProvenanceModal'
import { AttestActions } from '../components/provenance/AttestActions'
import { apiGet, apiPost } from '../lib/api'
import '../styles/provenance.css'

type ReleaseDetail = {
  id: number
  version: string
  notes?: string | null
  artifact_url: string
  artifact_sha256?: string | null
  license_code?: LicenseCode | null
  license_custom_text?: string | null
  license_url?: string | null
  created_at: string
  project: { id: number; name: string }
}

type DemoModeResponse = { demo: boolean }
type PrepareCopyrightResponse = {
  download_url: string
  receipt: string
}

type Toast = { id: number; text: string; kind?: 'ok' | 'error' }

type ModalState =
  | { kind: 'copyright'; status: 'loading' | 'success' | 'error'; data?: PrepareCopyrightResponse; error?: string }

function useToast() {
  const [items, setItems] = useState<Toast[]>([])
  const idRef = useRef(1)

  const push = (text: string, kind?: 'ok' | 'error') => {
    const id = idRef.current++
    setItems(prev => [...prev, { id, text, kind }])
    setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id))
    }, 3200)
  }

  const view = (
    <div>
      {items.map(t => (
        <div key={t.id} className={`toast ${t.kind || ''}`}>{t.text}</div>
      ))}
    </div>
  )

  return { push, view }
}

function Spinner() {
  return <span className="spinner" />
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore clipboard errors */
    }
  }

  return (
    <button
      className={`ghost provenance-copy ${copied ? 'is-copied' : ''}`}
      type="button"
      onClick={handleCopy}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function buildDemoPrepare(releaseId: number): PrepareCopyrightResponse {
  const suffix = releaseId.toString().padStart(4, '0')
  return {
    download_url: `https://routeforge.demo/ip/filings/release-${releaseId}.zip`,
    receipt: `RF-DEMO-${suffix}`,
  }
}

export function Release() {
  const toast = useToast()
  const releaseId = useMemo(() => {
    const parts = window.location.pathname.split('/').filter(Boolean)
    const maybe = parts[parts.length - 1]
    const parsed = Number.parseInt(maybe || '', 10)
    return Number.isFinite(parsed) && !Number.isNaN(parsed) ? parsed : null
  }, [])

  const [release, setRelease] = useState<ReleaseDetail | null>(null)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [loadingRelease, setLoadingRelease] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [modal, setModal] = useState<ModalState | null>(null)

  useEffect(() => {
    let alive = true
    const fetchFlags = async () => {
      try {
        const flags = await apiGet<DemoModeResponse>('/api/demo-mode')
        if (!alive) return
        setDemoMode(Boolean(flags.demo))
      } catch {
        if (!alive) return
        setDemoMode(false)
      }
    }
    fetchFlags()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!releaseId) {
      setReleaseError('Missing release id in URL.')
      return
    }

    let alive = true
    const load = async () => {
      setLoadingRelease(true)
      setReleaseError(null)
      try {
        const detail = await apiGet<ReleaseDetail>(`/api/releases/${releaseId}`)
        if (!alive) return
        setRelease(detail)
      } catch (e: any) {
        if (!alive) return
        const message = e?.message ? String(e.message) : 'Failed to load release'
        setReleaseError(message)
      } finally {
        if (alive) setLoadingRelease(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [releaseId])

  const openPrepare = () => {
    if (!releaseId) return

    if (demoMode) {
      const data = buildDemoPrepare(releaseId)
      setModal({ kind: 'copyright', status: 'success', data })
      toast.push(`Prepared filing ${data.receipt}`, 'ok')
      return
    }

    setModal({ kind: 'copyright', status: 'loading' })
    apiPost<{ release_id: number }, PrepareCopyrightResponse>('/api/ip/copyright/prepare', { release_id: releaseId })
      .then(data => {
        setModal({ kind: 'copyright', status: 'success', data })
        toast.push(`Prepared filing ${data.receipt}`, 'ok')
      })
      .catch(err => {
        const message = err?.message ? String(err.message) : 'Unable to prepare filing'
        setModal({ kind: 'copyright', status: 'error', error: message })
        toast.push(message, 'error')
      })
  }

  const closeModal = () => setModal(null)

  const licenseMeta = release?.license_code ? (
    <div className="release-meta__license">
      <span className="muted release-meta__license-label">License</span>
      <span className="license-preview">
        <LicenseBadge code={release.license_code as LicenseCode} />
        {release.license_code === 'CUSTOM' ? (
          release.license_custom_text ? (
            <span className="license-preview__text">Custom terms provided</span>
          ) : null
        ) : release.license_url ? (
          <a className="release-meta__license-link" href={release.license_url} target="_blank" rel="noreferrer">
            View terms
          </a>
        ) : null}
      </span>
    </div>
  ) : null

  const releaseMeta = release ? (
    <div className="card release-meta">
      <div className="release-meta__header">
        <div>
          <div className="heading release-meta__title">Release v{release.version}</div>
          <div className="release-meta__project">Project · {release.project?.name || release.project?.id}</div>
        </div>
        <div className="release-meta__actions">
          <a className="release-meta__link" href={release.artifact_url} target="_blank" rel="noreferrer">
            View artifact
          </a>
          <a
            className="release-meta__link"
            href={`/api/releases/${release.id}/evidence.zip`}
            target="_blank"
            rel="noreferrer"
          >
            Download evidence
          </a>
        </div>
      </div>
      {licenseMeta}
      <p className={release.notes ? 'release-meta__notes' : 'release-meta__notes muted'}>
        {release.notes || 'No release notes provided.'}
      </p>
    </div>
  ) : null

  const actions = [
    {
      key: 'filing',
      title: 'Prepare copyright filing',
      description: 'Bundle the paperwork needed for copyright submission in one download.',
      cta: 'Prepare filing',
      onClick: openPrepare,
    },
  ]

  const filingOpen = modal?.kind === 'copyright'

  const filingSubtitle =
    filingOpen && modal.status === 'success'
      ? demoMode
        ? 'Demo filing package is ready to download.'
        : 'Filing package ready to download.'
      : undefined

  return (
    <div className="container provenance-container">
      {releaseMeta}

      <div className="card provenance-card">
        <div className="provenance-card__header">
          <div>
            <div className="heading provenance-heading">Attest &amp; provenance tools</div>
            <p className="muted provenance-subheading">
              Generate proofs, mint NFTs, and prep filings directly from this release. Demo mode returns instant mock results.
            </p>
          </div>
          {demoMode && <DemoBadge />}
        </div>

        <div className="provenance-actions">
          <AttestActions
            releaseId={releaseId}
            disabled={!release || loadingRelease}
            onToast={toast.push}
          />
          {actions.map(action => (
            <div key={action.key} className="provenance-action">
              <div className="provenance-action__text">
                <div className="provenance-action__title">{action.title}</div>
                <p className="provenance-action__desc">{action.description}</p>
              </div>
              <button
                className="primary"
                type="button"
                onClick={action.onClick}
                disabled={!release || loadingRelease}
              >
                {action.cta}
              </button>
            </div>
          ))}
        </div>

        {loadingRelease && (
          <div className="provenance-hint">
            <Spinner /> Loading release…
          </div>
        )}
        {releaseError && <div className="provenance-hint provenance-hint--error">Error: {releaseError}</div>}
      </div>

      <ProvenanceModal
        open={Boolean(filingOpen)}
        title="Prepare filing"
        status={filingOpen ? modal.status : 'loading'}
        onClose={closeModal}
        loadingText="Assembling paperwork…"
        errorText={filingOpen && modal.status === 'error' ? modal.error : undefined}
        subtitle={filingSubtitle}
      >
        {filingOpen && modal.status === 'success' && modal.data && (
          <div className="provenance-detail-stack">
            <div className="provenance-detail">
              <span className="provenance-detail__label">Download package</span>
              <a className="provenance-link" href={modal.data.download_url} target="_blank" rel="noreferrer">
                Download package
              </a>
            </div>
            <div className="provenance-detail">
              <span className="provenance-detail__label">Receipt</span>
              <div className="provenance-detail__value provenance-detail__value--split">
                <code className="provenance-detail__code">{modal.data.receipt}</code>
                <CopyButton text={modal.data.receipt} />
              </div>
            </div>
          </div>
        )}
      </ProvenanceModal>

      {toast.view}
    </div>
  )
}

export default Release
