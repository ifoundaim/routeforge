import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DemoBadge } from '../components/DemoBadge'
import { MintStatusBadge } from '../components/MintStatusBadge'
import { ProvenanceModal } from '../components/ProvenanceModal'
import { usePresentMode } from './AppLayout'
import Tour from '../components/Tour'
import type { AttestMetadataFields, AttestModalPayload } from '../components/provenance/AttestActions'
import { AttestSection } from '../components/Release/Attest'
import { EvidenceSection } from '../components/Release/Evidence'
import { LicenseSection } from '../components/Release/License'
import { PublishSection } from '../components/Release/Publish'
import { PublicShareSection } from '../components/Release/PublicShare'
import { apiGet, apiPost } from '../lib/api'
import '../styles/provenance.css'
import '../styles/release.css'
import '../styles/tour.css'

type ReleaseRoute = {
  id: number
  slug: string
  target_url: string
}

type ReleaseDetail = {
  id: number
  version: string
  notes?: string | null
  artifact_url: string
  artifact_sha256?: string | null
  license_code?: string | null
  license_custom_text?: string | null
  license_url?: string | null
  created_at: string
  evidence_ipfs_cid?: string | null
  project: { id: number; name: string; owner?: string | null }
  latest_route?: ReleaseRoute | null
}

type DemoModeResponse = { demo: boolean }
type PrepareCopyrightResponse = {
  download_url: string
  receipt: string
}

type Toast = { id: number; text: string; kind?: 'ok' | 'error' }

type ModalState =
  | { kind: 'copyright'; status: 'loading' | 'success' | 'error'; data?: PrepareCopyrightResponse; error?: string }
  | { kind: 'attest'; status: 'success'; data: AttestModalData }
  | { kind: 'attest'; status: 'error'; error: string }

type AttestModalData = {
  txHash: string
  explorerUrl: string
  mode: 'log' | 'nft'
  tokenId?: number | null
  metadataUri?: string | null
  artifactSha256: string
  licenseCode: string
  evidenceUri: string
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return value
  }
}

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
  const presentCtx = usePresentMode()
  const toast = useToast()
  const [tourOpen, setTourOpen] = useState(false)
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

  const attestMetadata = useMemo<AttestMetadataFields | null>(() => {
    if (!releaseId || !release) return null
    let evidenceUri = `/api/releases/${releaseId}/evidence.zip`
    if (typeof window !== 'undefined' && window.location?.origin) {
      evidenceUri = new URL(`/api/releases/${releaseId}/evidence.zip`, window.location.origin).toString()
    }
    return {
      artifactSha256: release.artifact_sha256?.trim() || 'unknown',
      licenseCode: release.license_code?.trim() || 'none',
      evidenceUri,
    }
  }, [release, releaseId])

  const evidenceDownloadHref = release ? `/api/releases/${release.id}/evidence.zip` : null
  const evidenceCopyTarget = useMemo(() => {
    if (attestMetadata?.evidenceUri) return attestMetadata.evidenceUri
    if (!releaseId) return null
    if (typeof window !== 'undefined' && window.location?.origin) {
      return new URL(`/api/releases/${releaseId}/evidence.zip`, window.location.origin).toString()
    }
    return release ? `/api/releases/${release.id}/evidence.zip` : null
  }, [attestMetadata, release, releaseId])
  const evidenceIpfsCid = release?.evidence_ipfs_cid?.trim() || null
  const evidenceIpfsUri = evidenceIpfsCid ? `ipfs://${evidenceIpfsCid}` : null
  const evidenceIpfsGateway = evidenceIpfsCid ? `https://ipfs.io/ipfs/${evidenceIpfsCid}` : null
  const releaseNotes = release?.notes?.trim() || null
  const projectRef = release?.project
  const projectName = projectRef?.name || (projectRef?.id ? `Project ${projectRef.id}` : null)
  const projectOwner = projectRef?.owner?.trim() || null
  const releaseCreatedAt = release ? formatDateTime(release.created_at) : '—'
  const latestRoute = release?.latest_route || null
  const latestRouteSlug = latestRoute?.slug?.trim() || null
  const latestRouteHref = latestRouteSlug
    ? `/app/routes/${latestRouteSlug}`
    : latestRoute
      ? `/app/routes/id/${latestRoute.id}`
      : null
  const latestRouteLabel = latestRouteSlug ? `/r/${latestRouteSlug}` : latestRoute ? `Route ${latestRoute.id}` : 'Not minted yet'

  const handleAttestModal = useCallback(
    (payload: AttestModalPayload) => {
      if (payload.status === 'success') {
        setModal({
          kind: 'attest',
          status: 'success',
          data: {
            txHash: payload.data.txHash,
            explorerUrl: payload.data.explorerUrl,
            mode: payload.data.mode,
            tokenId: payload.data.tokenId,
            metadataUri: payload.data.metadataUri,
            artifactSha256: payload.data.artifactSha256,
            licenseCode: payload.data.licenseCode,
            evidenceUri: payload.data.evidenceUri,
          },
        })
      } else if (payload.status === 'error') {
        setModal({ kind: 'attest', status: 'error', error: payload.error })
      }
    },
    [setModal],
  )

  const actions = [
    {
      key: 'filing',
      title: 'Prepare copyright filing',
      description: 'Bundle the paperwork needed for copyright submission in one download.',
      cta: 'Prepare filing',
      onClick: openPrepare,
    },
  ]

  const infoCard = (
    <div className="card release-meta release-section">
      <div className="release-header">
        <h1 className="heading release-header__title">{release ? `Release v${release.version}` : 'Release details'}</h1>
        <div className="release-header__spacer" />
        <div className="release-header__actions">
          <MintStatusBadge />
          {presentCtx?.present ? (
            <button type="button" className="ghost" onClick={() => setTourOpen(true)}>Start Tour</button>
          ) : null}
        </div>
      </div>
      <div className="provenance-detail-stack release-section__content" data-tour="published">
        <div className="provenance-detail">
          <span className="provenance-detail__label">Project</span>
          <span className="provenance-detail__value">{projectName ? projectName : 'Loading project…'}</span>
        </div>
        <div className="provenance-detail">
          <span className="provenance-detail__label">Published</span>
          <span className="provenance-detail__value">{release ? releaseCreatedAt : loadingRelease ? 'Loading…' : '—'}</span>
        </div>
        {projectOwner ? (
          <div className="provenance-detail">
            <span className="provenance-detail__label">Project owner</span>
            <span className="provenance-detail__value">{projectOwner}</span>
          </div>
        ) : null}
        <div className="provenance-detail" data-tour="route">
          <span className="provenance-detail__label">Latest route</span>
          <span className="provenance-detail__value">
            {latestRouteHref ? (
              <a className="provenance-link" href={latestRouteHref} target="_blank" rel="noreferrer">{latestRouteLabel}</a>
            ) : ('Not minted yet')}
          </span>
        </div>
        <div className="provenance-detail">
          <span className="provenance-detail__label">Artifact</span>
          {release?.artifact_url ? (
            <div className="provenance-detail__value provenance-detail__value--split">
              <a className="provenance-link" href={release.artifact_url} target="_blank" rel="noreferrer">Open artifact</a>
              <CopyButton text={release.artifact_url} />
            </div>
          ) : (
            <span className="provenance-detail__value">—</span>
          )}
        </div>
      </div>
      <p className={releaseNotes ? 'release-meta__notes' : 'release-meta__notes muted'}>
        {releaseNotes || (loadingRelease ? 'Loading release notes…' : 'No release notes provided.')}
      </p>
    </div>
  )

  const licenseCard = (
    <LicenseSection
      releaseId={release?.id || null}
      initialCode={release?.license_code as any}
      initialCustomText={release?.license_custom_text || undefined}
      url={release?.license_url || undefined}
      onToast={toast.push}
    />
  )

  const evidenceCard = (
    <EvidenceSection
      downloadHref={evidenceDownloadHref}
      copyHref={evidenceCopyTarget}
      ipfsCid={evidenceIpfsCid}
    />
  )

  const filingOpen = modal?.kind === 'copyright'
  const filingStatus = filingOpen ? modal.status : null
  const filingModalStatus: 'loading' | 'success' | 'error' = filingStatus ?? 'loading'
  const filingSubtitle =
    modal?.kind === 'copyright' && modal.status === 'success'
      ? demoMode
        ? 'Demo filing package is ready to download.'
        : 'Filing package ready to download.'
      : undefined

  const attestationOpen = modal?.kind === 'attest'
  const attestationStatus = attestationOpen ? modal.status : null
  const attestationModalStatus: 'loading' | 'success' | 'error' = attestationStatus ?? 'loading'
  const attestationSubtitle =
    attestationOpen && attestationStatus === 'success'
      ? modal.data.mode === 'nft'
        ? 'NFT minted on Base.'
        : 'On-chain log recorded.'
      : undefined
  const attestationData = attestationOpen && attestationStatus === 'success' ? modal.data : null

  return (
    <div className="container provenance-container">
      {infoCard}
      <PublishSection release={release ? { id: release.id, version: release.version, artifact_url: release.artifact_url, artifact_sha256: release.artifact_sha256 } : undefined} onToast={toast.push} />
      {licenseCard}
      {evidenceCard}
      <AttestSection
        releaseId={releaseId}
        demoMode={demoMode}
        disabled={!release || loadingRelease}
        metadataFields={attestMetadata ?? undefined}
        onToast={toast.push}
        onAttestModal={handleAttestModal}
      />
      <PublicShareSection releaseId={release?.id} projectId={release?.project?.id} />

      <ProvenanceModal
        open={Boolean(filingOpen)}
        title="Prepare filing"
        status={filingModalStatus}
        onClose={closeModal}
        loadingText="Assembling paperwork…"
        errorText={filingOpen && filingStatus === 'error' ? modal.error : undefined}
        subtitle={filingSubtitle}
      >
        {filingOpen && filingStatus === 'success' && modal.data && (
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

      <ProvenanceModal
        open={Boolean(attestationOpen)}
        title="Attestation record"
        status={attestationModalStatus}
        onClose={closeModal}
        errorText={attestationOpen && attestationStatus === 'error' ? modal.error : undefined}
        subtitle={attestationSubtitle}
        loadingText="Submitting attestation…"
      >
        {attestationData ? (
          <div className="provenance-detail-stack">
            <div className="provenance-detail">
              <span className="provenance-detail__label">Attestation type</span>
              <span className="provenance-detail__value">
                {attestationData.mode === 'nft' ? 'NFT minted on Base' : 'Log fallback recorded'}
              </span>
            </div>
            <div className="provenance-detail">
              <span className="provenance-detail__label">Transaction hash</span>
              <div className="provenance-detail__value provenance-detail__value--split">
                <a className="provenance-link" href={attestationData.explorerUrl} target="_blank" rel="noreferrer">
                  {attestationData.txHash}
                </a>
                <CopyButton text={attestationData.txHash} />
              </div>
            </div>
            {typeof attestationData.tokenId === 'number' || attestationData.tokenId ? (
              <div className="provenance-detail">
                <span className="provenance-detail__label">Token ID</span>
                <div className="provenance-detail__value provenance-detail__value--split">
                  <code className="provenance-detail__code">{attestationData.tokenId}</code>
                  <CopyButton text={String(attestationData.tokenId)} />
                </div>
              </div>
            ) : null}
            {attestationData.metadataUri ? (
              <div className="provenance-detail">
                <span className="provenance-detail__label">Metadata URI</span>
                <div className="provenance-detail__value provenance-detail__value--split">
                  <a className="provenance-link" href={attestationData.metadataUri} target="_blank" rel="noreferrer">
                    {attestationData.metadataUri}
                  </a>
                  <CopyButton text={attestationData.metadataUri} />
                </div>
              </div>
            ) : null}
            <div className="provenance-detail">
              <span className="provenance-detail__label">Artifact SHA256</span>
              <div className="provenance-detail__value provenance-detail__value--split">
                <code className="provenance-detail__code">{attestationData.artifactSha256}</code>
                <CopyButton text={attestationData.artifactSha256} />
              </div>
            </div>
            <div className="provenance-detail">
              <span className="provenance-detail__label">License code</span>
              <div className="provenance-detail__value provenance-detail__value--split">
                <code className="provenance-detail__code">{attestationData.licenseCode.toUpperCase()}</code>
                <CopyButton text={attestationData.licenseCode} />
              </div>
            </div>
            <div className="provenance-detail">
              <span className="provenance-detail__label">Evidence URI</span>
              <div className="provenance-detail__value provenance-detail__value--split">
                <a className="provenance-link" href={attestationData.evidenceUri} target="_blank" rel="noreferrer">
                  {attestationData.evidenceUri}
                </a>
                <CopyButton text={attestationData.evidenceUri} />
              </div>
            </div>
          </div>
        ) : null}
      </ProvenanceModal>

      {toast.view}

      {presentCtx?.present && tourOpen ? (
        <Tour
          active={tourOpen}
          onClose={() => setTourOpen(false)}
          steps={[
            {
              key: 'publish',
              selector: '[data-tour="published"] .release-meta__header',
              title: 'Publish',
              body: 'Releases are published with metadata, artifact, and project context.'
            },
            {
              key: 'route',
              selector: '[data-tour="route"] .provenance-detail__value',
              title: 'Open Route',
              body: 'Jump to the latest minted route for this release.'
            },
            {
              key: 'evidence',
              selector: '[data-tour="evidence"]',
              title: 'Evidence',
              body: 'Download the full evidence package and copy canonical links.'
            },
            {
              key: 'attest',
              selector: '[data-tour="attest"] .provenance-action__title',
              title: 'Attest',
              body: 'Mint an NFT receipt on Base or fall back to an on-chain log.'
            },
            {
              key: 'filing',
              selector: '[data-tour="filing"] button.primary',
              title: 'Filing',
              body: 'Prepare a copyright filing package for this release.'
            },
          ]}
        />
      ) : null}

      {/* Floating start removed; wired to title row action */}
    </div>
  )
}

export default Release
