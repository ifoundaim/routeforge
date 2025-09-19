import React from 'react'

export type UTMSource = {
  source: string
  count: number
}

type UTMChipsProps = {
  sources: UTMSource[]
  loading?: boolean
  limit?: number
  activeSource?: string | null
  onSelect?: (next: string | null) => void
  emptyLabel?: string
}

const CHIP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 999,
  padding: '4px 10px',
  fontSize: 12,
  border: '1px solid var(--muted)',
  background: 'var(--panel)',
  color: 'var(--text)',
  cursor: 'pointer',
  transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
}

const ACTIVE_STYLE: React.CSSProperties = {
  borderColor: 'var(--accent)',
  background: 'rgba(96,165,250,0.1)',
  color: 'var(--accent)',
}

const PLACEHOLDER_STYLE: React.CSSProperties = {
  ...CHIP_STYLE,
  color: 'var(--muted)',
  cursor: 'default',
  borderColor: 'rgba(107,114,128,0.45)',
  background: 'rgba(107,114,128,0.12)',
}

export function UTMChips({
  sources,
  loading = false,
  limit = 5,
  activeSource = null,
  onSelect,
  emptyLabel = 'No tracked UTM sources yet.',
}: UTMChipsProps) {
  if (loading) {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-hidden>
        {Array.from({ length: Math.min(limit, 4) }).map((_, index) => (
          <span key={index} style={PLACEHOLDER_STYLE}>UTM source</span>
        ))}
      </div>
    )
  }

  const filtered = (sources || []).filter(item => item && item.source)
  if (!filtered.length) {
    return <p className="muted" style={{ margin: 0 }}>{emptyLabel}</p>
  }

  const visible = filtered
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, limit))

  const handleClick = (source: string) => {
    if (!onSelect) {
      return
    }
    const next = activeSource === source ? null : source
    onSelect(next)
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {visible.map(item => {
        const isActive = activeSource === item.source
        const style = isActive ? { ...CHIP_STYLE, ...ACTIVE_STYLE } : CHIP_STYLE
        return (
          <button
            key={item.source}
            type="button"
            onClick={() => handleClick(item.source)}
            style={style}
            aria-pressed={isActive}
          >
            <span>{item.source}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{item.count}</span>
          </button>
        )
      })}
      {activeSource ? (
        <button
          type="button"
          onClick={() => onSelect?.(null)}
          style={{ ...CHIP_STYLE, color: 'var(--muted)' }}
        >
          Clear
        </button>
      ) : null}
    </div>
  )
}

