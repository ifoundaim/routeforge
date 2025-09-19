import React from 'react'

import '../styles/license.css'

export type LicenseCode = 'MIT' | 'Apache-2.0' | 'CC-BY-4.0' | 'CUSTOM'

type LicenseOption = {
  code: LicenseCode
  label: string
  description: string
}

type LicenseStepProps = {
  selected: LicenseCode
  customText: string
  onSelect: (code: LicenseCode) => void
  onCustomChange: (value: string) => void
}

const LICENSE_OPTIONS: LicenseOption[] = [
  {
    code: 'MIT',
    label: 'MIT',
    description: 'Permissive, simple, and business-friendly.',
  },
  {
    code: 'Apache-2.0',
    label: 'Apache 2.0',
    description: 'Includes patent protection with permissive use.',
  },
  {
    code: 'CC-BY-4.0',
    label: 'CC BY 4.0',
    description: 'Creative Commons with attribution for creative works.',
  },
  {
    code: 'CUSTOM',
    label: 'Custom',
    description: 'Provide a tailored license for this release.',
  },
]

const LICENSE_LABELS: Record<LicenseCode, string> = {
  MIT: 'MIT',
  'Apache-2.0': 'Apache 2.0',
  'CC-BY-4.0': 'CC BY 4.0',
  CUSTOM: 'Custom',
}

export function LicenseStep({ selected, customText, onSelect, onCustomChange }: LicenseStepProps) {
  return (
    <section className="agent-section" aria-label="License">
      <div>
        <h3 className="agent-section__title">License</h3>
        <p className="agent-section__description">
          Pick the license we surface alongside your release artifact and preview summary.
        </p>
      </div>
      <div className="license-grid" role="group" aria-label="Select a license">
        {LICENSE_OPTIONS.map(option => {
          const isSelected = option.code === selected
          return (
            <button
              type="button"
              key={option.code}
              className={`license-option${isSelected ? ' license-option--selected' : ''}`}
              onClick={() => onSelect(option.code)}
              aria-pressed={isSelected}
            >
              <LicenseBadge code={option.code} />
              <span className="license-option__description">{option.description}</span>
            </button>
          )
        })}
      </div>
      {selected === 'CUSTOM' ? (
        <div className="agent-field license-custom">
          <label htmlFor="license-custom-text">Custom license text</label>
          <textarea
            id="license-custom-text"
            name="license_custom_text"
            placeholder="Add the exact license text or summary you want to show in Preview."
            value={customText}
            onChange={event => onCustomChange(event.target.value)}
            rows={4}
          />
        </div>
      ) : null}
    </section>
  )
}

export function LicenseBadge({ code }: { code: LicenseCode }) {
  const label = LICENSE_LABELS[code]
  const modifier = code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return <span className={`license-badge license-badge--${modifier}`}>{label}</span>
}

export function describeLicense(code: LicenseCode): string {
  return LICENSE_LABELS[code] || code
}
