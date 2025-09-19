import React, { useEffect, useMemo, useState } from 'react'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { Abi } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'

import { apiGet, apiPost } from '../../lib/api'
import { WalletProvider, useStarknetConfig, connectStarknetWallet } from '../../wallet'
import type { StarknetWallet } from '../../wallet/starknet'

const BASE_EXPLORER_FALLBACK = 'https://sepolia.basescan.org/tx'

const DEFAULT_DESC = 'Mint a provenance receipt on Base Sepolia. When minting is unavailable, a signed log will be recorded instead.'
const DEFAULT_STARK_DESC = 'Mint a provenance receipt on Starknet Sepolia. When not configured, a demo log will be recorded instead.'

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

  const { config: starkConfig, error: starkError, loading: starkLoading } = useStarknetConfig()
  const [starkWallet, setStarkWallet] = useState<StarknetWallet | null>(null)
  const [starkPending, setStarkPending] = useState(false)
  const [starkResult, setStarkResult] = useState<AttestResultSnapshot | null>(null)

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
    setStarkResult(null)
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

  const handleStarkLogFallback = async () => {
    if (!releaseId) {
      onToast('Missing release reference for Starknet attestation.', 'error')
      return
    }
    setStarkPending(true)
    try {
      const response = await apiPost<{}, AttestResponsePayload>(
        `/api/releases/${releaseId}/attest/starknet`,
        {}
      )
      const explorerUrl = buildExplorerUrl(starkConfig?.explorer_tx_base, response.tx_hash)
      setStarkResult({ txHash: response.tx_hash, explorerUrl, mode: 'log', metadataUri: response.metadata_uri, tokenId: response.token_id })
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
      onToast('Recorded demo Starknet log.', 'ok')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record demo Starknet attestation.'
      onToast(message, 'error')
      onAttestModal?.({ status: 'error', error: message })
    } finally {
      setStarkPending(false)
    }
  }

  const connectStarknet = async () => {
    try {
      const wallet = await connectStarknetWallet()
      if (!wallet) {
        onToast('Starknet wallet not found. Install ArgentX or Braavos.', 'error')
        return null
      }
      setStarkWallet(wallet)
      return wallet
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Starknet wallet.'
      onToast(message, 'error')
      return null
    }
  }

  const handleStarkMint = async () => {
    if (!releaseId) {
      onToast('Missing release reference for Starknet mint.', 'error')
      return
    }
    if (!starkConfig?.contract) {
      await handleStarkLogFallback()
      return
    }
    let wallet = starkWallet
    if (!wallet) {
      wallet = await connectStarknet()
      if (!wallet) return
    }

    const metadataUri = new URL(`/api/releases/${releaseId}/evidence.zip`, window.location.origin).toString()

    // Attempt best-effort wallet invoke. Calldata is contract-specific; we send address + hashed URI.
    // If the wallet rejects or invocation fails, we keep UX non-blocking and do demo fallback.
    setStarkPending(true)
    try {
      const mod = await import('starknet')
      const uriHash = mod.hash.starknetKeccak(metadataUri)
      const call: any = {
        contractAddress: starkConfig.contract,
        entrypoint: 'mint',
        calldata: [wallet.address, uriHash],
      }
      const res: any = await wallet.account?.execute ? wallet.account.execute(call) : wallet.provider?.request?.({
        type: 'INVOKE_FUNCTION',
        method: 'starknet_addInvokeTransaction',
        params: [{ contract_address: starkConfig.contract, entry_point_selector: 'mint', calldata: [wallet.address, uriHash] }],
      })
      const txHash: string = res?.transaction_hash || res?.transactionHash || res?.hash || res?.result || '0x'
      if (!txHash || txHash === '0x') throw new Error('Starknet transaction failed to submit.')

      onToast('Starknet transaction submitted. Waiting for confirmation…', 'ok')

      // Submit to backend to record metadata URI and echo tx
      const response = await apiPost<{ tx_hash: string }, AttestResponsePayload>(
        `/api/releases/${releaseId}/attest/starknet`,
        { tx_hash: txHash }
      )

      const explorerUrl = buildExplorerUrl(starkConfig.explorer_tx_base, response.tx_hash)
      setStarkResult({ txHash: response.tx_hash, explorerUrl, mode: 'nft', metadataUri: response.metadata_uri, tokenId: response.token_id })
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
      onToast('Minted attestation on Starknet.', 'ok')
    } catch (err: any) {
      if (err?.code === 4001 || err?.message?.toLowerCase?.().includes('user rejected')) {
        onToast('Starknet transaction cancelled.', 'error')
        onAttestModal?.({ status: 'error', error: 'Transaction cancelled.' })
      } else {
        // Demo fallback if any error occurs
        await handleStarkLogFallback()
      }
    } finally {
      setStarkPending(false)
    }
  }

  const busy = pending || disabled || loadingConfig
  const starkBusy = starkPending || disabled || starkLoading
  const hasContract = Boolean(config?.contract && config?.abi)
  const hasStarkContract = Boolean(starkConfig?.contract)
  const helperText = hasContract
    ? 'Requires Base Sepolia wallet signature.'
    : 'No mint contract configured; falls back to on-chain event log.'
  const starkHelperText = hasStarkContract
    ? 'Requires Starknet Sepolia wallet signature.'
    : 'Starknet not configured; falls back to demo log.'

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
      <div className="provenance-action__divider" style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
      <div className="provenance-action__text">
        <div className="provenance-action__title">Mint on Starknet</div>
        <p className="provenance-action__desc">{starkError ? starkError : DEFAULT_STARK_DESC}</p>
        <p className="provenance-action__desc" style={{ marginTop: 6 }}>{starkHelperText}</p>
        <div className="provenance-wallet">
          <button className="secondary" type="button" onClick={connectStarknet} disabled={starkBusy}>
            {starkWallet?.address ? `${starkWallet.address.slice(0, 8)}…${starkWallet.address.slice(-6)}` : 'Connect Starknet'}
          </button>
          <span className="provenance-wallet__network">Starknet Sepolia</span>
        </div>
        {starkResult && (
          <div className="provenance-hint" style={{ marginTop: 12 }}>
            <span>{starkResult.mode === 'nft' ? 'Minted tx' : 'Log tx'}:</span>
            <a className="provenance-link" href={starkResult.explorerUrl} target="_blank" rel="noreferrer">
              {starkResult.txHash}
            </a>
          </div>
        )}
        {starkResult?.metadataUri && (
          <div className="provenance-hint" style={{ marginTop: 8 }}>
            <span>Metadata URI:</span>
            <a className="provenance-link" href={starkResult.metadataUri} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>
              {starkResult.metadataUri}
            </a>
            <span style={{ marginLeft: 6 }}>
              <CopyButtonLocal text={starkResult.metadataUri} />
            </span>
          </div>
        )}
      </div>
      <button
        className="primary"
        type="button"
        onClick={hasStarkContract ? handleStarkMint : handleStarkLogFallback}
        disabled={starkBusy || !releaseId}
      >
        {starkBusy ? 'Working…' : hasStarkContract ? 'Mint (Starknet)' : 'Demo (Starknet not configured)'}
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
