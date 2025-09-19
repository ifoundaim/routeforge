import React, { useEffect, useMemo, useState } from 'react'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { Abi } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'

import { apiGet, apiPost } from '../../lib/api'
import { WalletProvider } from '../../wallet'

const BASE_EXPLORER_FALLBACK = 'https://sepolia.basescan.org/tx'

const DEFAULT_DESC = 'Mint a provenance receipt on Base Sepolia. When minting is unavailable, a signed log will be recorded instead.'

export type AttestMetadataFields = {
  artifactSha256: string
  licenseCode: string
  evidenceUri: string
}

export type AttestModalPayload =
  | {
      status: 'success'
      data: {
        txHash: string
        explorerUrl: string
        mode: 'log' | 'nft'
        tokenId?: number | null
        metadataUri?: string | null
      } & AttestMetadataFields
    }
  | { status: 'error'; error: string }

interface AttestActionsProps {
  releaseId: number | null
  disabled?: boolean
  onToast: (text: string, kind?: 'ok' | 'error') => void
  metadataFields?: AttestMetadataFields
  onAttestModal?: (payload: AttestModalPayload) => void
}

interface AttestConfig {
  chain_id: number
  chain_name: string
  rpc_url?: string | null
  contract?: string | null
  mint_function: string
  mint_inputs: string[]
  abi?: Abi | null
  requires_wallet: boolean
  wallet_enabled?: boolean
  custodial_enabled?: boolean
  abi_fn?: string
  base_rpc_url_set?: boolean
  mode: 'demo' | 'testnet' | 'off'
  explorer_tx_base?: string | null
}

interface AttestResponsePayload {
  tx_hash: string
  metadata_uri?: string | null
  token_id?: number | null
  mode: 'demo' | 'testnet' | 'off'
}

interface AttestResultSnapshot {
  txHash: string
  explorerUrl: string
  mode: 'log' | 'nft'
  metadataUri?: string | null
  tokenId?: number | null
}

function CopyButtonLocal({ text }: { text: string }) {
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

function parseMintSignature(signature: string): { name: string; inputs: string[] } {
  const trimmed = signature.trim()
  if (!trimmed.includes('(')) {
    return { name: trimmed, inputs: [] }
  }
  const name = trimmed.slice(0, trimmed.indexOf('(')).trim()
  const args = trimmed.slice(trimmed.indexOf('(') + 1, trimmed.lastIndexOf(')'))
  const inputs = args ? args.split(',').map(part => part.trim()).filter(Boolean) : []
  return { name, inputs }
}

function buildExplorerUrl(base: string | null | undefined, txHash: string): string {
  const prefix = (base && base.trim()) || BASE_EXPLORER_FALLBACK
  const normalized = prefix.endsWith('/tx') ? prefix : `${prefix.replace(/\/$/, '')}/tx`
  return `${normalized}/${txHash}`
}

function buildMintArgs(
  inputs: string[],
  wallet: string,
  metadataUri: string,
  releaseId: number
): unknown[] {
  return inputs.map(input => {
    const normalized = input.toLowerCase()
    if (normalized.startsWith('address')) {
      return wallet
    }
    if (normalized.startsWith('string')) {
      return metadataUri
    }
    if (normalized.startsWith('uint')) {
      return BigInt(releaseId)
    }
    throw new Error(`Unsupported mint function input: ${input}`)
  })
}

function composeMetadataFields(
  releaseId: number | null,
  fields?: AttestMetadataFields,
): AttestMetadataFields {
  let fallbackEvidence = ''
  if (releaseId != null) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      fallbackEvidence = new URL(`/api/releases/${releaseId}/evidence.zip`, window.location.origin).toString()
    } else {
      fallbackEvidence = `/api/releases/${releaseId}/evidence.zip`
    }
  }

  const artifactSha256 = fields?.artifactSha256?.trim() || 'unknown'
  const licenseCode = fields?.licenseCode?.trim() || 'none'
  const evidenceUri = fields?.evidenceUri?.trim() || fallbackEvidence

  return {
    artifactSha256,
    licenseCode,
    evidenceUri,
  }
}

function AttestActionsInner({ releaseId, disabled, onToast, metadataFields, onAttestModal }: AttestActionsProps) {
  const [config, setConfig] = useState<AttestConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<AttestResultSnapshot | null>(null)

  const { address, chain, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: config?.chain_id })
  const { writeContractAsync } = useWriteContract()

  const signature = useMemo(() => {
    return parseMintSignature(config?.mint_function || 'safeMint(address,string)')
  }, [config?.mint_function])

  const mintInputs = useMemo(() => {
    if (config?.mint_inputs?.length) return config.mint_inputs
    return signature.inputs
  }, [config?.mint_inputs, signature.inputs])

  useEffect(() => {
    let active = true
    setLoadingConfig(true)
    setConfigError(null)
    apiGet<AttestConfig>('/api/attest/config')
      .then(data => {
        if (!active) return
        setConfig(data)
      })
      .catch(err => {
        if (!active) return
        const message = err instanceof Error ? err.message : 'Unable to load mint configuration.'
        setConfigError(message)
        setConfig(null)
      })
      .finally(() => {
        if (!active) return
        setLoadingConfig(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setResult(null)
  }, [releaseId])

  const handleLogFallback = async () => {
    if (!releaseId) {
      onToast('Missing release reference for attestation.', 'error')
      return
    }
    setPending(true)
    try {
      const response = await apiPost<{ mode: 'log' }, AttestResponsePayload>(
        `/api/releases/${releaseId}/attest`,
        { mode: 'log' }
      )
      const explorerUrl = buildExplorerUrl(config?.explorer_tx_base, response.tx_hash)
      setResult({ txHash: response.tx_hash, explorerUrl, mode: 'log', metadataUri: response.metadata_uri, tokenId: response.token_id })
      const metadata = composeMetadataFields(releaseId, metadataFields)
      onAttestModal?.({
        status: 'success',
        data: {
          txHash: response.tx_hash,
          explorerUrl,
          mode: 'log',
          metadataUri: response.metadata_uri,
          tokenId: response.token_id,
          ...metadata,
        },
      })
      onToast('Recorded log attestation on Base.', 'ok')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record log attestation.'
      onToast(message, 'error')
      onAttestModal?.({ status: 'error', error: message })
    } finally {
      setPending(false)
    }
  }

  const handleMint = async () => {
    if (!config?.contract || !config?.abi) {
      await handleLogFallback()
      return
    }
    if (!releaseId) {
      onToast('Missing release reference for mint.', 'error')
      return
    }
    if (!isConnected || !address) {
      onToast('Connect a wallet to mint this attestation.', 'error')
      return
    }
    if (chain?.id !== config.chain_id) {
      try {
        await switchChainAsync?.({ chainId: config.chain_id })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Network switch was rejected.'
        onToast(message, 'error')
        return
      }
    }

    if (!publicClient) {
      onToast('Unable to reach Base RPC client.', 'error')
      return
    }

    const metadataUri = new URL(`/api/releases/${releaseId}/evidence.zip`, window.location.origin).toString()
    let args: unknown[]
    try {
      args = buildMintArgs(mintInputs, address, metadataUri, releaseId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unsupported mint configuration.'
      onToast(message, 'error')
      return
    }

    setPending(true)
    try {
      const hash = await writeContractAsync({
        address: config.contract as `0x${string}`,
        abi: config.abi as Abi,
        functionName: signature.name as any,
        args,
        chainId: config.chain_id,
      })

      onToast('Transaction submitted. Waiting for confirmation…', 'ok')
      await publicClient.waitForTransactionReceipt({ hash })

      const response = await apiPost<{ mode: 'nft'; tx_hash: string }, AttestResponsePayload>(
        `/api/releases/${releaseId}/attest`,
        { mode: 'nft', tx_hash: hash }
      )

      const explorerUrl = buildExplorerUrl(config.explorer_tx_base, response.tx_hash)
      setResult({ txHash: response.tx_hash, explorerUrl, mode: 'nft', metadataUri: response.metadata_uri, tokenId: response.token_id })
      const metadata = composeMetadataFields(releaseId, metadataFields)
      onAttestModal?.({
        status: 'success',
        data: {
          txHash: response.tx_hash,
          explorerUrl,
          mode: 'nft',
          metadataUri: response.metadata_uri,
          tokenId: response.token_id,
          ...metadata,
        },
      })
      onToast('Minted attestation on Base.', 'ok')
    } catch (err: any) {
      if (err?.code === 4001 || err?.message?.toLowerCase?.().includes('user rejected')) {
        onToast('Transaction cancelled.', 'error')
        onAttestModal?.({ status: 'error', error: 'Transaction cancelled.' })
      } else {
        const message = err instanceof Error ? err.message : 'Mint failed.'
        onToast(message, 'error')
        onAttestModal?.({ status: 'error', error: message })
      }
    } finally {
      setPending(false)
    }
  }

  const busy = pending || disabled || loadingConfig
  const hasContract = Boolean(config?.contract && config?.abi)
  const helperText = hasContract
    ? 'Requires Base Sepolia wallet signature.'
    : 'No mint contract configured; falls back to on-chain event log.'

  return (
    <div className="provenance-action">
      <div className="provenance-action__text">
        <div className="provenance-action__title">Mint provenance receipt</div>
        <p className="provenance-action__desc">{configError ? configError : DEFAULT_DESC}</p>
        <p className="provenance-action__desc" style={{ marginTop: 6 }}>{helperText}</p>
        <div className="provenance-wallet">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
          <span className="provenance-wallet__network">Base Sepolia</span>
        </div>
        {result && (
          <div className="provenance-hint" style={{ marginTop: 12 }}>
            <span>{result.mode === 'nft' ? 'Minted tx' : 'Log tx'}:</span>
            <a className="provenance-link" href={result.explorerUrl} target="_blank" rel="noreferrer">
              {result.txHash}
            </a>
          </div>
        )}
        {result?.metadataUri && (
          <div className="provenance-hint" style={{ marginTop: 8 }}>
            <span>Metadata URI:</span>
            <a className="provenance-link" href={result.metadataUri} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>
              {result.metadataUri}
            </a>
            <span style={{ marginLeft: 6 }}>
              <CopyButtonLocal text={result.metadataUri} />
            </span>
          </div>
        )}
        {(typeof result?.tokenId === 'number' || result?.tokenId) && (
          <div className="provenance-hint" style={{ marginTop: 8 }}>
            <span>Token ID:</span>
            <code className="provenance-detail__code" style={{ marginLeft: 6 }}>{result?.tokenId}</code>
            {result?.tokenId != null && (
              <span style={{ marginLeft: 6 }}>
                <CopyButtonLocal text={String(result.tokenId)} />
              </span>
            )}
          </div>
        )}
      </div>
      <button
        className="primary"
        type="button"
        onClick={hasContract ? handleMint : handleLogFallback}
        disabled={busy || !releaseId}
      >
        {busy ? 'Working…' : hasContract ? 'Mint on Base' : 'Record log'}
      </button>
    </div>
  )
}

export function AttestActions(props: AttestActionsProps) {
  return (
    <WalletProvider>
      <AttestActionsInner {...props} />
    </WalletProvider>
  )
}
