import React, { useMemo, useState } from 'react'

import { LicenseBadge, LicenseStep, type LicenseCode } from '../LicenseStep'
import { apiPatch } from '../../lib/api'

type LicenseProps = {
  releaseId: number | null
  initialCode?: LicenseCode | null
  initialCustomText?: string | null
  url?: string | null
  onToast?: (text: string, kind?: 'ok' | 'error') => void
}

type ReleaseLicenseResponse = {
  license_code: LicenseCode
  license_url?: string | null
  license_custom_text?: string | null
}

export function LicenseSection({ releaseId, initialCode, initialCustomText, url, onToast }: LicenseProps) {
  const [code, setCode] = useState<LicenseCode>(initialCode || 'MIT')
  const [customText, setCustomText] = useState<string>(initialCustomText || '')
  const [busy, setBusy] = useState(false)

  const trimmedCustom = useMemo(() => customText.trim(), [customText])

  const save = async () => {
    if (!releaseId) return
    setBusy(true)
    try {
      const payload: { license_code: LicenseCode; custom_text?: string } = { license_code: code }
      if (code === 'CUSTOM' && trimmedCustom) payload.custom_text = trimmedCustom
      await apiPatch<typeof payload, ReleaseLicenseResponse>(`/api/releases/${releaseId}/license`, payload)
      onToast?.('License saved', 'ok')
    } catch (err: any) {
      onToast?.(err?.message || 'Failed to save license', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card release-section">
      <div className="release-section__header">
        <div className="heading release-section__title">License</div>
        {code ? <LicenseBadge code={code} /> : <span className="muted">Not provided</span>}
      </div>
      <div className="release-section__content">
        <LicenseStep selected={code} customText={customText} onSelect={setCode} onCustomChange={setCustomText} />
        {url ? (
          <a className="provenance-link" href={url} target="_blank" rel="noreferrer">View license terms</a>
        ) : null}
        <div>
          <button type="button" className="primary" onClick={save} disabled={!releaseId || busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

export default LicenseSection


