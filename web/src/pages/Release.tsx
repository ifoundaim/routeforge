import React, { useEffect, useMemo, useRef, useState } from 'react'

import { DemoBadge } from '../components/DemoBadge'
import { ProvenanceModal } from '../components/ProvenanceModal'
import { apiGet, apiPost } from '../lib/api'
import '../styles/provenance.css'

type ReleaseDetail = {
  id: number
  version: string
  notes?: string | null
  artifact_url: string
  created_at: string
  project: { id: number; name: string }
}

type DemoModeResponse = { demo: boolean }
type AttestResponse = {
  release_id: number
  sha256: string
  network: string
  tx_hash: string
  token_id: number | null
  metadata_uri: string | null
  dry_run: boolean
}

type PrepareCopyrightResponse = {
  download_url: string
  receipt: string
}

type Toast = { id: number; text: string; kind?: 'ok' | 'error' }

type ModalState =
  | { kind: 'attest'; mode: 'log' | 'nft'; status: 'loading' | 'success' | 'error'; data?: AttestResponse; error?: string }
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

function CopyButton({ text, onCopied }: { text: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      onCopied?.()
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

function makeDemoHex(seed: string, releaseId: number) {
  const base = `${seed}${releaseId.toString(16).padStart(6, '0')}`
  const repeated = base.repeat(5)
  return (repeated + seed).slice(0, 64)
}

function buildDemoAttest(mode: 'log' | 'nft', releaseId: number): AttestResponse {
  const txHash = makeDemoHex('9b4cfe1d3a7c', releaseId)
  const digest = makeDemoHex('b1cd9463c8ed', releaseId)
  const tokenId = mode === 'nft' ? releaseId * 1000 + 421 : null

  return {
    release_id: releaseId,
    sha256: digest,
    network: 'RouteChain Testnet',
    tx_hash: `0x${txHash}`,
    token_id: tokenId,
    metadata_uri: tokenId ? `ipfs://demo.routeforge/releases/${releaseId}` : null,
    dry_run: true,
  }
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

  const openAttest = (mode: 'log' | 'nft') => {
    if (!releaseId) return

    if (demoMode) {
      const data = buildDemoAttest(mode, releaseId)
      setModal({ kind: 'attest', mode, status: 'success', data })
      const label = mode === 'nft' ? `Minted demo NFT token ${data.token_id}` : `Attested release (tx ${data.tx_hash})`
      toast.push(label, 'ok')
      return
    }

    setModal({ kind: 'attest', mode, status: 'loading' })
    apiPost<{ mode: 'log' | 'nft' }, AttestResponse>(`/api/releases/${releaseId}/attest`, { mode })
      .then(data => {
        setModal({ kind: 'attest', mode, status: 'success', data })
        const label = mode === 'nft' ? `Minted NFT token ${data.token_id}` : `Attested release (tx ${data.tx_hash})`
        toast.push(label, 'ok')
      })
      .catch(err => {
        const message = err?.message ? String(err.message) : 'Unable to process request'
        setModal({ kind: 'attest', mode, status: 'error', error: message })
        toast.push(message, 'error')
      })
  }

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

  const releaseMeta = release ? (
    <div className="card release-meta">
      <div className="release-meta__header">
        <div>
          <div className="heading release-meta__title">Release v{release.version}</div>
          <div className="release-meta__project">Project · {release.project?.name || release.project?.id}</div>
        </div>
        <a className="release-meta__link" href={release.artifact_url} target="_blank" rel="noreferrer">
          View artifact
        </a>
      </div>
      <p className={release.notes ? 'release-meta__notes' : 'release-meta__notes muted'}>
        {release.notes || 'No release notes provided.'}
      </p>
    </div>
  ) : null

  const actions = [
    {
      key: 'attest',
      title: 'Attest release',
      description: 'Record a ledger proof of this artifact to seal provenance.',
      cta: 'Attest release',
      onClick: () => openAttest('log'),
    },
    {
      key: 'nft',
      title: 'Mint release NFT',
      description: 'Issue a collectible NFT referencing this build for downstream traceability.',
      cta: 'Mint NFT',
      onClick: () => openAttest('nft'),
    },
    {
      key: 'filing',
      title: 'Prepare copyright filing',
      description: 'Bundle the paperwork needed for copyright submission in one download.',
      cta: 'Prepare filing',
      onClick: openPrepare,
    },
  ]

  const attestOpen = modal?.kind === 'attest'
  const filingOpen = modal?.kind === 'copyright'

  const attestSubtitle =
    attestOpen && modal.status === 'success'
      ? modal.mode === 'nft'
        ? demoMode
          ? 'NFT minted in Route Forge demo environment.'
          : 'NFT minted successfully.'
        : demoMode
          ? 'Release attestation logged in the demo ledger.'
          : 'Release attested successfully.'
      : undefined

  const filingSubtitle =
    filingOpen && modal.status === 'success'
      ? demoMode
        ? 'Demo filing package is ready to download.'
        : 'Filing package ready to download.'
      : undefined

  const explorerUrl = (tokenId: number | null | undefined) =>
    tokenId == null ? '#' : `https://explorer.routeforge.demo/token/${tokenId}`

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
        open={Boolean(attestOpen)}
        title={attestOpen && modal.mode === 'nft' ? 'Mint NFT' : 'Attest release'}
        status={attestOpen ? modal.status : 'loading'}
        onClose={closeModal}
        loadingText="Contacting attestor…"
        errorText={attestOpen && modal.status === 'error' ? modal.error : undefined}
        subtitle={attestSubtitle}
      >
        {attestOpen && modal.status === 'success' && modal.data && (
          <div className="provenance-detail-stack">
            <div className="provenance-detail">
              <span className="provenance-detail__label">Network</span>
              <span className="provenance-detail__value">{modal.data.network}</span>
            </div>
            <div className="provenance-detail">
              <span className="provenance-detail__label">Transaction hash</span>
              <div className="provenance-detail__value provenance-detail__value--split">
                <code className="provenance-detail__code">{modal.data.tx_hash}</code>
                <CopyButton text={modal.data.tx_hash} />
              </div>
            </div>
            <div className="provenance-detail">
              <span className="provenance-detail__label">Release digest (SHA-256)</span>
              <code className="provenance-detail__code">{modal.data.sha256}</code>
            </div>
            {modal.mode === 'nft' && modal.data.token_id != null && (
              <div className="provenance-detail">
                <span className="provenance-detail__label">Token ID</span>
                <div className="provenance-detail__value provenance-detail__value--split">
                  <span>{modal.data.token_id}</span>
                  <a
                    className="provenance-link"
                    href={explorerUrl(modal.data.token_id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on explorer
                  </a>
                </div>
              </div>
            )}
            {modal.mode === 'nft' && modal.data.metadata_uri && (
              <div className="provenance-detail">
                <span className="provenance-detail__label">Metadata URI</span>
                <code className="provenance-detail__code">{modal.data.metadata_uri}</code>
              </div>
            )}
          </div>
        )}
      </ProvenanceModal>

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
