import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LicenseBadge, LicenseStep, type LicenseCode } from '../components/LicenseStep'
import { UploadField } from '../components/UploadField'
import { SimilarRelease, SimilarReleases } from '../components/SimilarReleases'
import { ToastShelf, useToastQueue } from '../components/Toast'
import { apiPatch } from '../lib/api'
import { isModEnter, isMultilineInput, isPlainEnter } from '../lib/keys'
import '../styles/agent.css'

type AgentDecision = 'dry_run' | 'published' | 'review'

type AgentRelease = {
  project_id: number
  version: string
  notes?: string | null
  artifact_url: string
  id?: number
  created_at?: string
  artifact_sha256?: string | null
}

type AgentRoute = {
  id: number
  slug: string
  target_url: string
}

type AgentAuditEntry = {
  action: string
  [key: string]: unknown
}

type AgentPublishResponse = {
  decision: AgentDecision
  message?: string
  release: AgentRelease
  route: AgentRoute | null
  similar_releases: SimilarRelease[]
  audit_sample: AgentAuditEntry[]
  license_code?: LicenseCode
  license_text?: string
}

type ReleaseLicenseResponse = {
  license_code: LicenseCode
  license_url?: string | null
  license_custom_text?: string | null
}

type AgentPublishModalProps = {
  open: boolean
  projectId: number
  projectName?: string
  initialArtifactUrl?: string
  initialNotes?: string
  onClose: () => void
  onPublished?: (response: AgentPublishResponse) => void
}

type ActiveAction = 'preview' | 'publish' | null

function buildDisplayJson(meta: AgentAuditEntry): string {
  const { action: _action, ...rest } = meta
  if (!Object.keys(rest).length) return '{}'
  try {
    return JSON.stringify(rest, null, 2)
  } catch {
    return String(meta)
  }
}

export function AgentPublishModal({
  open,
  projectId,
  projectName,
  initialArtifactUrl = '',
  initialNotes = '',
  onClose,
  onPublished,
}: AgentPublishModalProps) {
  const [artifactUrl, setArtifactUrl] = useState(initialArtifactUrl)
  const [notes, setNotes] = useState(initialNotes)
  const [result, setResult] = useState<AgentPublishResponse | null>(null)
  const [active, setActive] = useState<ActiveAction>(null)
  const [licenseCode, setLicenseCode] = useState<LicenseCode>('MIT')
  const [customLicenseText, setCustomLicenseText] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadFieldKey, setUploadFieldKey] = useState(0)

  const formRef = useRef<HTMLFormElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const { items: toasts, push: pushToast, remove: removeToast } = useToastQueue()

  const isPreviewing = active === 'preview'
  const isPublishing = active === 'publish'
  const trimmedCustomLicenseText = useMemo(() => customLicenseText.trim(), [customLicenseText])
  const licenseFields = useMemo(
    () => ({
      license_code: licenseCode,
      license_text: licenseCode === 'CUSTOM' && trimmedCustomLicenseText ? trimmedCustomLicenseText : undefined,
    }),
    [licenseCode, trimmedCustomLicenseText],
  )
  const previewLicenseCode: LicenseCode = result?.license_code ?? licenseFields.license_code
  const previewLicenseText = result?.license_text ?? licenseFields.license_text
  const auditEntries = result?.audit_sample || []

  useEffect(() => {
    if (!open) return
    setArtifactUrl(initialArtifactUrl)
    setNotes(initialNotes)
    setResult(null)
    setLicenseCode('MIT')
    setCustomLicenseText('')
    setIsUploading(false)
    setUploadFieldKey(prev => prev + 1)
  }, [open, initialArtifactUrl, initialNotes])

  useEffect(() => {
    setResult(prev => {
      if (!prev) return prev
      if (prev.license_code === licenseFields.license_code && prev.license_text === licenseFields.license_text) {
        return prev
      }
      return { ...prev, ...licenseFields }
    })
  }, [licenseFields])

  useEffect(() => {
    if (!open) return

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const body = document.body
    const originalOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      firstFieldRef.current?.focus()
    }, 20)

    return () => {
      window.clearTimeout(focusTimer)
      body.style.overflow = originalOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab') return
      const container = modalRef.current
      if (!container) return

      const focusable = getFocusableElements(container)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement as HTMLElement | null
      if (event.shiftKey) {
        if (current === first || !container.contains(current)) {
          event.preventDefault()
          last.focus()
        }
      } else if (current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const container = modalRef.current
    container?.addEventListener('keydown', handleKeyDown)
    return () => {
      container?.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  const isFormValid = useMemo(() => {
    return artifactUrl.trim().length > 0 && !isUploading
  }, [artifactUrl, isUploading])

  const resetActive = () => setActive(null)

  const handleUploadComplete = useCallback(
    (publicUrl: string) => {
      setArtifactUrl(publicUrl)
      setResult(null)
      pushToast('Artifact uploaded', 'ok')
    },
    [pushToast],
  )

  const handleUploadError = useCallback(
    (message: string) => {
      pushToast(message, 'error')
    },
    [pushToast],
  )

  const persistLicenseSelection = async (releaseId: number) => {
    const payload: { license_code: LicenseCode; custom_text?: string } = {
      license_code: licenseCode,
    }
    if (licenseCode === 'CUSTOM' && trimmedCustomLicenseText) {
      payload.custom_text = trimmedCustomLicenseText
    }
    await apiPatch<typeof payload, ReleaseLicenseResponse>(`/api/releases/${releaseId}/license`, payload)
  }

  const request = async ({ dryRun, force }: { dryRun: boolean; force?: boolean }) => {
    const payload: Record<string, unknown> = {
      project_id: projectId,
      artifact_url: artifactUrl.trim(),
    }
    const trimmedNotes = notes.trim()
    if (trimmedNotes) payload.notes = trimmedNotes
    if (dryRun) payload.dry_run = true
    if (force) payload.force = true

    const res = await fetch('/agent/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const requestId = res.headers.get('x-request-id') || res.headers.get('X-Request-ID') || undefined
    const text = await res.text()
    let data: AgentPublishResponse | null = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch (error) {
        const err = new Error('Server returned an unreadable response.')
        ;(err as any).requestId = requestId
        throw err
      }
    }

    if (!res.ok) {
      const message = (data as any)?.message || (data as any)?.error || `Request failed (${res.status})`
      const err = new Error(message)
      ;(err as any).requestId = requestId
      throw err
    }

    if (!data) {
      const err = new Error('Server returned an empty response.')
      ;(err as any).requestId = requestId
      throw err
    }

    return { data, requestId }
  }

  const handlePreview = async () => {
    if (isUploading) return
    if (!formRef.current) return
    if (!(formRef.current.reportValidity?.() ?? true)) return

    setActive('preview')
    try {
      const { data } = await request({ dryRun: true })
      const dataWithLicense = { ...data, ...licenseFields }
      setResult(dataWithLicense)
      if (data.message) {
        pushToast(data.message, 'ok')
      }
    } catch (error: any) {
      const requestId = error?.requestId
      console.error('Agent preview error', { message: error?.message, requestId })
      const label = requestId ? `${error?.message} (request ${requestId})` : error?.message || 'Preview failed'
      pushToast(label, 'error')
    } finally {
      resetActive()
    }
  }

  const handlePublish = async () => {
    if (isUploading) return
    if (!result) {
      await handlePreview()
      return
    }
    setActive('publish')
    try {
      const { data, requestId } = await request({
        dryRun: false,
        force: result.decision === 'review',
      })
      if (data.release?.id) {
        try {
          await persistLicenseSelection(data.release.id)
        } catch (error: any) {
          console.error('Persist license error', { message: error?.message, releaseId: data.release.id })
          pushToast('Release saved, but we could not persist the license selection.', 'error')
        }
      }
      const dataWithLicense = { ...data, ...licenseFields }
      setResult(dataWithLicense)
      onPublished?.(dataWithLicense)
      const routeSlug = data.route?.slug
      const decisionLabel = routeSlug ? `Route ${routeSlug} minted` : 'Release published'
      pushToast(decisionLabel, 'ok')
      if (requestId) {
        console.info('Agent publish request', { requestId })
      }
      onClose()
    } catch (error: any) {
      const requestId = error?.requestId
      console.error('Agent publish error', { message: error?.message, requestId })
      const label = requestId ? `${error?.message} (request ${requestId})` : error?.message || 'Publish failed'
      pushToast(label, 'error')
    } finally {
      resetActive()
    }
  }

  const onFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (isModEnter(event)) {
      event.preventDefault()
      if (!isPublishing) {
        handlePublish()
      }
      return
    }
    if (isPlainEnter(event) && !isMultilineInput(event.target)) {
      event.preventDefault()
      if (!isPreviewing && isFormValid) {
        handlePreview()
      }
    }
  }

  const overlay = open ? (
    <div className="agent-modal-overlay" role="presentation">
      <div
        className="agent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-publish-title"
        aria-describedby="agent-publish-description"
        ref={modalRef}
      >
        <header className="agent-modal__header">
          <div>
            <p className="agent-modal__eyebrow">Agent publish</p>
            <h2 id="agent-publish-title" className="agent-modal__title">Preview &amp; Publish</h2>
            <p id="agent-publish-description" className="agent-modal__subtitle">
              Submit an artifact for project {projectName || `#${projectId}`}.
            </p>
          </div>
          <button type="button" className="agent-modal__close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="agent-modal__body">
          <section className="agent-section" aria-label="Inputs">
            <div>
              <h3 className="agent-section__title">Inputs</h3>
              <p className="agent-section__description">Provide the artifact URL and optional notes used for similarity checks.</p>
            </div>
            <form
              ref={formRef}
              className="agent-form"
              onSubmit={event => {
                event.preventDefault()
                handlePreview()
              }}
              onKeyDown={onFormKeyDown}
            >
              <div className="agent-field">
                <label htmlFor="agent-artifact">Artifact URL</label>
                <input
                  id="agent-artifact"
                  ref={firstFieldRef}
                  name="artifact"
                  type="url"
                  placeholder="https://example.com/builds/app-v1.2.3.zip"
                  required
                  value={artifactUrl}
                  onChange={event => setArtifactUrl(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <UploadField
                key={uploadFieldKey}
                onUploaded={handleUploadComplete}
                onError={handleUploadError}
                onUploadStateChange={value => setIsUploading(value)}
              />
              <div className="agent-field">
                <label htmlFor="agent-notes">Notes for audit trail</label>
                <textarea
                  id="agent-notes"
                  name="notes"
                  placeholder="Release highlights, ticket references, validation summary"
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                />
              </div>
            </form>
          </section>

          <LicenseStep
            selected={licenseCode}
            customText={customLicenseText}
            onSelect={setLicenseCode}
            onCustomChange={setCustomLicenseText}
          />

          <section className="agent-section" aria-label="Actions">
            <div>
              <h3 className="agent-section__title">Actions</h3>
              <p className="agent-section__description">Dry-run first to review similarity hits, then publish once it looks good.</p>
            </div>
            <div className="agent-actions">
              <div className="agent-actions__buttons">
                <button
                  type="button"
                  className="primary"
                  onClick={handlePreview}
                  disabled={!isFormValid || isPreviewing || isPublishing}
                >
                  {isPreviewing ? 'Previewing...' : 'Preview (dry run)'}
                </button>
                <button
                  type="button"
                  disabled={!result || isPublishing || isUploading}
                  onClick={handlePublish}
                >
                  {isPublishing ? 'Publishing...' : 'Publish'}
                </button>
              </div>
              <div className="agent-actions__hint">
                <span className="agent-actions__hint-kbd">Enter</span>
                <span>Preview</span>
                <span className="agent-actions__hint-kbd">Cmd/Ctrl + Enter</span>
                <span>Publish</span>
              </div>
            </div>
          </section>

          <section className="agent-section agent-results" aria-live="polite">
            <div>
              <h3 className="agent-section__title">Results</h3>
              <p className="agent-section__description">Release details, minted slug, and audit breadcrumbs from the agent.</p>
            </div>

            {result ? (
              <>
                <div className="agent-results__grid">
                  <div className="agent-card">
                    <span className="agent-card__label">Decision</span>
                    <span className="agent-card__value">{formatDecision(result.decision)}</span>
                    <span className="agent-card__label">Version</span>
                    <span className="agent-card__value">{result.release.version}</span>
                    <span className="agent-card__label">Artifact</span>
                    <span className="agent-card__value agent-card__value--muted">{result.release.artifact_url}</span>
                    <span className="agent-card__label">License</span>
                    <span className="agent-card__value">
                      <span className="license-preview">
                        <LicenseBadge code={previewLicenseCode} />
                        {previewLicenseText ? (
                          <span className="license-preview__text">{previewLicenseText}</span>
                        ) : null}
                      </span>
                    </span>
                    {result.release.notes ? (
                      <>
                        <span className="agent-card__label">Notes</span>
                        <span className="agent-card__value agent-card__value--muted">{result.release.notes}</span>
                      </>
                    ) : null}
                  </div>

                  <div className="agent-card">
                    <span className="agent-card__label">Route slug</span>
                    <span className="agent-card__value">
                      {result.route?.slug ? result.route.slug : 'Route will mint on publish'}
                    </span>
                    <span className="agent-card__label">Target URL</span>
                    <span className="agent-card__value agent-card__value--muted">
                      {result.route?.target_url || result.release.artifact_url}
                    </span>
                    <span className="agent-card__label">Project</span>
                    <span className="agent-card__value agent-card__value--muted">{projectName || `#${projectId}`}</span>
                  </div>
                </div>

                <div className="agent-panel" aria-label="Audit trail">
                  <div className="agent-panel__header">
                    <h3 className="agent-panel__title">Audit steps</h3>
                    <span className="agent-panel__hint">Agent logged {auditEntries.length} step(s)</span>
                  </div>
                  {auditEntries.length ? (
                    <ul className="agent-audit-list">
                      {auditEntries.map((entry, index) => (
                        <li key={`${entry.action}-${index}`} className="agent-audit-item">
                          <span className="agent-audit-item__action">{entry.action}</span>
                          <code className="agent-audit-item__meta">{buildDisplayJson(entry)}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="agent-empty">No audit entries returned.</div>
                  )}
                </div>

                {result.similar_releases?.length ? (
                  <SimilarReleases items={result.similar_releases} />
                ) : null}
              </>
            ) : (
              <div className="agent-empty">Run Preview to inspect the release summary, slug, and audit checkpoints.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      {overlay}
      <ToastShelf items={toasts} onDismiss={removeToast} />
    </>
  )
}

function getFocusableElements(container: HTMLElement) {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(el => !el.hasAttribute('aria-hidden'))
}

function formatDecision(decision: AgentDecision): string {
  if (decision === 'dry_run') return 'Dry run ready'
  if (decision === 'review') return 'Needs human review'
  return 'Published'
}
