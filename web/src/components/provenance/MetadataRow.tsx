import React, { useState } from 'react'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }
  return (
    <button className={`ghost provenance-copy ${copied ? 'is-copied' : ''}`} type="button" onClick={handleCopy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function MetadataRow({ uri }: { uri: string }) {
  if (!uri) return null
  return (
    <div className="provenance-hint" style={{ marginTop: 8 }}>
      <span>Metadata URI:</span>
      <a className="provenance-link" href={uri} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>
        {uri}
      </a>
      <span style={{ marginLeft: 6 }}>
        <CopyButton text={uri} />
      </span>
    </div>
  )
}

export default MetadataRow


