import React, { useCallback, useMemo, useRef, useState } from 'react'

import { LicenseBadge, type LicenseCode } from '../LicenseStep'
import { UploadField } from '../UploadField'
import { apiPatch } from '../../lib/api'

type ReleaseLite = {
  id: number
  version: string
  artifact_url: string
  artifact_sha256?: string | null
}

type PublishResult = {
  artifact_sha256?: string | null
  evidence_uri?: string | null
  license_code?: LicenseCode | null
}

type ReleaseLicenseResponse = {
  license_code: LicenseCode
  license_url?: string | null
  license_custom_text?: string | null
}

type PublishProps = {
  release?: ReleaseLite | null
  onToast?: (text: string, kind?: 'ok' | 'error') => void
}

export function PublishSection({ release, onToast }: PublishProps) {
  const [artifactUrl, setArtifactUrl] = useState<string>(release?.artifact_url || '')
  const [licenseCode, setLicenseCode] = useState<LicenseCode | null>(null)
  const [customLicenseText, setCustomLicenseText] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)

  const canPublish = useMemo(() => artifactUrl.trim().length > 0 && !isUploading && !busy, [artifactUrl, isUploading, busy])

  const handleUploadComplete = useCallback((url: string) => {
    setArtifactUrl(url)
    onToast?.('Artifact uploaded', 'ok')
  }, [onToast])

  const handleUploadError = useCallback((message: string) => onToast?.(message, 'error'), [onToast])

  const handlePublish = async () => {
    if (!release?.id) return
    setBusy(true)
    try {
      // Persist license selection if user selected one here
      if (licenseCode) {
        const payload: { license_code: LicenseCode; custom_text?: string } = { license_code: licenseCode }
        if (licenseCode === 'CUSTOM' && customLicenseText.trim()) payload.custom_text = customLicenseText.trim()
        try {
          await apiPatch<typeof payload, ReleaseLicenseResponse>(`/api/releases/${release.id}/license`, payload)
        } catch (err: any) {
          onToast?.('Saved, but could not persist license.', 'error')
        }
      }

      // No direct publish API in SPA; rely on backend release already existing. Echo chips from known fields.
      setResult({
        artifact_sha256: release.artifact_sha256 || null,
        evidence_uri: new URL(`/api/releases/${release.id}/evidence.zip`, window.location.origin).toString(),
        license_code: (licenseCode as LicenseCode | null) || null,
      })
      onToast?.('Publish ready', 'ok')
    } catch (err: any) {
      const message = err?.message || 'Publish failed'
      onToast?.(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card release-section" data-tour="publish">
      <div className="release-section__header">
        <div className="heading release-section__title">Publish</div>
      </div>
      <div className="release-section__content">
        <div className="agent-field">
          <label htmlFor="release-artifact">Artifact URL</label>
          <input
            id="release-artifact"
            ref={firstRef}
            name="artifact"
            type="url"
            placeholder="https://example.com/builds/app-v1.2.3.zip"
            required
            value={artifactUrl}
            onChange={e => setArtifactUrl(e.target.value)}
            autoComplete="off"
          />
        </div>
        <UploadField onUploaded={handleUploadComplete} onError={handleUploadError} onUploadStateChange={setIsUploading} />

        <div className="agent-field">
          <label htmlFor="license-code">License (optional)</label>
          <select id="license-code" value={licenseCode || ''} onChange={e => setLicenseCode((e.target.value || null) as any)}>
            <option value="">—</option>
            <option value="MIT">MIT</option>
            <option value="Apache-2.0">Apache 2.0</option>
            <option value="CC-BY-4.0">CC BY 4.0</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </div>
        {licenseCode === 'CUSTOM' ? (
          <div className="agent-field">
            <label htmlFor="license-custom">Custom license text</label>
            <textarea id="license-custom" rows={3} value={customLicenseText} onChange={e => setCustomLicenseText(e.target.value)} />
          </div>
        ) : null}

        <div className="release-results">
          {result?.artifact_sha256 ? (
            <span className="release-chip">
              <span className="release-chip__label">Artifact</span>
              <code className="release-chip__code">sha256={result.artifact_sha256}</code>
            </span>
          ) : null}
          {result?.evidence_uri ? (
            <span className="release-chip">
              <span className="release-chip__label">Evidence</span>
              <a href={result.evidence_uri} className="provenance-link" target="_blank" rel="noreferrer">{result.evidence_uri}</a>
            </span>
          ) : null}
          {result?.license_code ? (
            <span className="release-chip">
              <span className="release-chip__label">License</span>
              <span className="license-preview"><LicenseBadge code={result.license_code} /></span>
            </span>
          ) : null}
        </div>

        <div>
          <button className="primary" type="button" onClick={handlePublish} disabled={!canPublish}>{busy ? 'Working…' : 'Publish'}</button>
        </div>
      </div>
    </div>
  )
}

export default PublishSection


