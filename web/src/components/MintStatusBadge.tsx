import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { apiGet } from '../lib/api'
import '../styles/status.css'

type MintMode = 'demo' | 'testnet' | 'off'

type AttestConfigStatus = {
  mode: MintMode
  wallet_enabled: boolean
  custodial_enabled: boolean
  abi_fn: string
  contract?: string | null
  base_rpc_url_set: boolean
}

type EvidenceStatus = {
  ipfs_enabled: boolean
  provider: 'web3' | 'pinata' | null
  cid_persist: boolean
}

function shortenContract(value?: string | null): { text: string; full: string | null } {
  if (!value) return { text: 'Not set', full: null }
  const trimmed = value.trim()
  if (trimmed.length <= 14) return { text: trimmed, full: trimmed }
  return { text: `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`, full: trimmed }
}

function describeIpfs(status: EvidenceStatus | null, error: string | null, loading: boolean): string {
  if (error) return `Error: ${error}`
  if (loading && !status) return 'Loading…'
  if (!status) return 'Unknown'
  if (!status.ipfs_enabled) return 'Disabled'
  const provider = status.provider === 'web3' ? 'web3.storage' : status.provider === 'pinata' ? 'Pinata' : 'Custom provider'
  const persistence = status.cid_persist ? 'persisting CID' : 'no CID persistence'
  return `${provider} · ${persistence}`
}

function toTitle(value: MintMode | null | undefined): string | null {
  if (!value) return null
  if (value === 'testnet') return 'Testnet'
  if (value === 'demo') return 'Demo'
  return 'Off'
}

export function MintStatusBadge(): JSX.Element {
  const [config, setConfig] = useState<AttestConfigStatus | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<EvidenceStatus | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setConfigError(null)
      setEvidenceError(null)

      try {
        const cfg = await apiGet<AttestConfigStatus>('/api/attest/config')
        if (!active) return
        setConfig(cfg)
      } catch (err: any) {
        if (!active) return
        const message = err instanceof Error ? err.message : 'Unable to load config.'
        setConfigError(message)
        setConfig(null)
      }

      try {
        const status = await apiGet<EvidenceStatus>('/api/evidence/status')
        if (!active) return
        setEvidence(status)
      } catch (err: any) {
        if (!active) return
        const message = err instanceof Error ? err.message : 'Unable to load evidence status.'
        setEvidence(null)
        setEvidenceError(message)
      }

      if (active) {
        setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [])

  const showTooltip = useCallback(() => setOpen(true), [])
  const hideTooltip = useCallback(() => setOpen(false), [])

  const mintParts = useMemo(() => {
    if (!config) return [] as string[]
    const parts: string[] = []
    const label = toTitle(config.mode)
    if (label) parts.push(label)
    if (config.wallet_enabled) parts.push('Wallet')
    if (config.custodial_enabled) parts.push('Custodial')
    if (!parts.length && config.mode) parts.push('Unknown')
    return parts
  }, [config])

  const tone = useMemo<'ok' | 'warn' | 'off'>(() => {
    if (configError) return 'off'
    if (!config) return 'warn'
    if (config.mode === 'testnet' && config.wallet_enabled) return 'ok'
    if (config.mode === 'off') return 'off'
    return 'warn'
  }, [config, configError])

  const label = useMemo(() => {
    if (configError) return 'Mint: Error'
    if (loading) return 'Mint: Loading…'
    if (!config) return 'Mint: Unknown'
    return `Mint: ${mintParts.join(' / ') || 'Unknown'}`
  }, [config, configError, loading, mintParts])

  const contractView = useMemo(() => shortenContract(config?.contract), [config?.contract])
  const ipfsLine = useMemo(
    () => describeIpfs(evidence, evidenceError, loading),
    [evidence, evidenceError, loading],
  )

  return (
    <div
      className="status-badge"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      <button
        type="button"
        className={`status-pill status-pill--${tone}`}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Mint and storage status summary"
      >
        <span className="status-pill__dot" aria-hidden="true" />
        <span>{label}</span>
      </button>
      <div className={`status-badge__tooltip${open ? ' is-visible' : ''}`}>
        {configError ? (
          <p className="status-badge__tooltip-note status-badge__tooltip-note--error">{configError}</p>
        ) : (
          <>
            {loading && !config ? (
              <p className="status-badge__tooltip-note">Loading status…</p>
            ) : (
              <>
                <div className="status-badge__tooltip-row">
                  <span className="status-badge__tooltip-label">Contract</span>
                  <span
                    className="status-badge__tooltip-value"
                    title={contractView.full ?? undefined}
                  >
                    {contractView.text}
                  </span>
                </div>
                <div className="status-badge__tooltip-row">
                  <span className="status-badge__tooltip-label">ABI Fn</span>
                  <span className="status-badge__tooltip-value" title={config?.abi_fn || undefined}>
                    {config?.abi_fn || '—'}
                  </span>
                </div>
                <div className="status-badge__tooltip-row">
                  <span className="status-badge__tooltip-label">IPFS</span>
                  <span className="status-badge__tooltip-value" title={ipfsLine}>
                    {ipfsLine}
                  </span>
                </div>
              </>
            )}
            {evidenceError && !configError ? (
              <p className="status-badge__tooltip-note status-badge__tooltip-note--warn">{evidenceError}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
