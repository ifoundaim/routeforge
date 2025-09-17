import React from 'react'

type ProvenanceModalStatus = 'loading' | 'success' | 'error'

type ProvenanceModalProps = {
  open: boolean
  title: string
  status: ProvenanceModalStatus
  onClose: () => void
  children?: React.ReactNode
  subtitle?: string
  loadingText?: string
  errorText?: string
}

export function ProvenanceModal({
  open,
  title,
  status,
  onClose,
  children,
  subtitle,
  loadingText,
  errorText,
}: ProvenanceModalProps) {
  if (!open) return null

  const statusMessage =
    status === 'loading'
      ? loadingText || 'Working on it…'
      : status === 'error'
        ? errorText || 'Something went wrong. Please try again.'
        : subtitle || 'Demo result ready.'

  return (
    <div className="provenance-modal-overlay" role="dialog" aria-modal="true">
      <div className="provenance-modal" data-status={status}>
        <header className="provenance-modal__header">
          <div>
            <div className="provenance-modal__title">{title}</div>
          </div>
          <button className="ghost provenance-modal__close" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="provenance-modal__status" data-status={status} aria-live="polite">
          {status === 'loading' && <span className="spinner" aria-hidden="true" />}
          {status === 'error' && <span className="provenance-modal__status-icon" data-variant="error" aria-hidden="true" />}
          {status === 'success' && <span className="provenance-modal__status-icon" data-variant="success" aria-hidden="true" />}
          <span>{statusMessage}</span>
        </div>

        <div className="provenance-modal__body">
          {status === 'success' ? children : null}
        </div>
      </div>
    </div>
  )
}
