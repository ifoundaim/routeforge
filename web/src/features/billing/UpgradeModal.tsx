import React from 'react'

type UpgradeModalProps = {
  open: boolean
  onClose: () => void
  onUpgrade: () => void | Promise<void>
  upgrading?: boolean
}

export function UpgradeModal({ open, onClose, onUpgrade, upgrading }: UpgradeModalProps) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="card" style={{ maxWidth: 420, width: '92%', padding: 24 }}>
        <div className="heading" style={{ marginBottom: 12 }}>Upgrade to Pro</div>
        <p style={{ marginTop: 0, marginBottom: 12 }}>
          Unlock Pro features (CSV export, Top Routes) to keep exploring RouteForge analytics.
        </p>
        <ul style={{ margin: '12px 0 20px', paddingLeft: 20 }}>
          <li>Download recent hits as CSV</li>
          <li>View detailed route analytics</li>
        </ul>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 12 }}>
          <button className="ghost" onClick={onClose} disabled={!!upgrading}>Not now</button>
          <button className="primary" onClick={() => { void onUpgrade() }} disabled={!!upgrading}>
            {upgrading ? 'Upgrading...' : 'Upgrade'}
          </button>
        </div>
      </div>
    </div>
  )
}
