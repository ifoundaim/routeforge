import React from 'react'

type EvidenceProps = {
  downloadHref?: string | null
  copyHref?: string | null
  ipfsCid?: string | null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch {}
  }
  return <button className={`ghost provenance-copy ${copied ? 'is-copied' : ''}`} onClick={onCopy} type="button">{copied ? 'Copied' : 'Copy'}</button>
}

export function EvidenceSection({ downloadHref, copyHref, ipfsCid }: EvidenceProps) {
  const ipfsUri = ipfsCid ? `ipfs://${ipfsCid}` : null
  const ipfsGateway = ipfsCid ? `https://ipfs.io/ipfs/${ipfsCid}` : null
  return (
    <div className="card release-section" data-tour="evidence">
      <div className="release-section__header">
        <div className="heading release-section__title">Evidence</div>
      </div>
      <div className="release-section__content">
        <div className="provenance-detail">
          <span className="provenance-detail__label">Download</span>
          {downloadHref ? (
            <div className="provenance-detail__value provenance-detail__value--split">
              <a className="provenance-link" href={downloadHref} target="_blank" rel="noreferrer">Evidence package</a>
              {copyHref ? <CopyButton text={copyHref} /> : null}
            </div>
          ) : (
            <span className="provenance-detail__value">Unavailable</span>
          )}
        </div>
        <div className="provenance-detail">
          <span className="provenance-detail__label">IPFS</span>
          {ipfsUri && ipfsGateway ? (
            <div className="provenance-detail__value provenance-detail__value--split">
              <a className="provenance-link" href={ipfsGateway} target="_blank" rel="noreferrer">{ipfsUri}</a>
              <CopyButton text={ipfsUri} />
            </div>
          ) : (
            <span className="provenance-detail__value muted">Not published to IPFS yet.</span>
          )}
        </div>
      </div>
      <p className="release-section__note muted">Keep handy when recording Present Mode walkthroughs.</p>
    </div>
  )
}

export default EvidenceSection


