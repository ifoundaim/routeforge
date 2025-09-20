import React from 'react'

import { DemoBadge } from '../DemoBadge'
import { AttestActions, type AttestMetadataFields, type AttestModalPayload } from '../provenance/AttestActions'

type AttestProps = {
  releaseId: number | null
  demoMode?: boolean
  disabled?: boolean
  metadataFields?: AttestMetadataFields
  onToast: (text: string, kind?: 'ok' | 'error') => void
  onAttestModal?: (payload: AttestModalPayload) => void
}

export function AttestSection({ releaseId, demoMode, disabled, metadataFields, onToast, onAttestModal }: AttestProps) {
  return (
    <div className="card provenance-card">
      <div className="provenance-card__header">
        <div>
          <div className="heading provenance-heading">Attest &amp; provenance tools</div>
          <p className="muted provenance-subheading">Generate proofs, mint NFTs, and prep filings directly from this release. Demo mode returns instant mock results.</p>
        </div>
        {demoMode && <DemoBadge />}
      </div>
      <div className="provenance-actions" data-tour="attest">
        <AttestActions
          releaseId={releaseId}
          disabled={disabled}
          onToast={onToast}
          metadataFields={metadataFields}
          onAttestModal={onAttestModal}
        />
      </div>
    </div>
  )
}

export default AttestSection


