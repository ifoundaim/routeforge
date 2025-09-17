import React from 'react'

export type SimilarRelease = {
  id: number
  version: string
  notes?: string | null
  score?: number
}

function formatDistance(score?: number): string {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'n/a'
  const safeScore = Math.max(score, 0.000_001)
  const distance = 1 / safeScore - 1
  if (!Number.isFinite(distance) || distance < 0) return 'n/a'
  return distance < 0.01 ? '0.00' : distance.toFixed(2)
}

export function SimilarReleases({ items }: { items: SimilarRelease[] }) {
  if (!items || items.length === 0) return null

  const top = items.slice(0, 3)

  return (
    <div className="agent-panel">
      <div className="agent-panel__header">
        <h3 className="agent-panel__title">Similar Releases</h3>
        <span className="agent-panel__hint">Top {top.length} potential duplicates</span>
      </div>
      <ul className="agent-similar-list">
        {top.map(item => (
          <li key={item.id} className="agent-similar-item">
            <div className="agent-similar-item__row">
              <span className="agent-similar-version">{item.version}</span>
              <span className="agent-similar-distance">Distance {formatDistance(item.score)}</span>
            </div>
            {item.notes ? (
              <p className="agent-similar-notes">{item.notes}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
