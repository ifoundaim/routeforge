import React, { useMemo, useState } from 'react'

type PublicShareProps = { releaseId?: number | null; projectId?: number | null }

export function PublicShareSection({ releaseId, projectId }: PublicShareProps) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const publicUrl = useMemo(() => (releaseId ? `${origin}/public/releases/${releaseId}` : null), [origin, releaseId])
  const ogImage = useMemo(() => (releaseId ? `${origin}/api/og/release/${releaseId}.png` : null), [origin, releaseId])
  const [copied, setCopied] = useState(false)
  const [copiedOg, setCopiedOg] = useState(false)

  const copy = async (text?: string | null, set: (v: boolean) => void) => {
    if (!text) return
    try { await navigator.clipboard.writeText(text); set(true); setTimeout(() => set(false), 1200) } catch {}
  }

  return (
    <div className="card release-section">
      <div className="release-section__header">
        <div className="heading release-section__title">Public share</div>
      </div>
      <div className="release-section__content">
        <div className="release-section__grid">
          <div>
            <div className="provenance-detail">
              <span className="provenance-detail__label">Public page</span>
              {publicUrl ? (
                <div className="provenance-detail__value provenance-detail__value--split">
                  <a className="provenance-link" href={publicUrl} target="_blank" rel="noreferrer">Open public page</a>
                  <button className={`ghost provenance-copy ${copied ? 'is-copied' : ''}`} onClick={() => copy(publicUrl, setCopied)} type="button">{copied ? 'Copied' : 'Copy'}</button>
                </div>
              ) : (
                <span className="provenance-detail__value">Unavailable</span>
              )}
            </div>
          </div>
          <div>
            <div className="provenance-detail">
              <span className="provenance-detail__label">OG image</span>
              {ogImage ? (
                <div className="provenance-detail__value provenance-detail__value--split">
                  <a className="provenance-link" href={ogImage} target="_blank" rel="noreferrer">Open image</a>
                  <button className={`ghost provenance-copy ${copiedOg ? 'is-copied' : ''}`} onClick={() => copy(ogImage, setCopiedOg)} type="button">{copiedOg ? 'Copied' : 'Copy'}</button>
                </div>
              ) : (
                <span className="provenance-detail__value">Unavailable</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PublicShareSection


