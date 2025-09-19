import { useEffect, useMemo, useState } from 'react'

import { apiGet } from '../lib/api'

type StarknetConfig = {
  rpc_url?: string | null
  contract?: string | null
  requires_wallet: boolean
  mode: 'starknet' | 'demo'
  explorer_tx_base?: string | null
  wallet_enabled: boolean
}

export type StarknetMintResult = {
  txHash: string
  explorerUrl: string
  mode: 'starknet' | 'demo'
  metadataUri?: string | null
  tokenId?: number | null
}

function buildExplorerUrl(base: string | null | undefined, txHash: string): string {
  const prefix = (base && base.trim()) || 'https://sepolia.starkscan.co/tx'
  const normalized = prefix.endsWith('/tx') ? prefix : `${prefix.replace(/\/$/, '')}/tx`
  return `${normalized}/${txHash}`
}

export function useStarknetConfig() {
  const [config, setConfig] = useState<StarknetConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    apiGet<StarknetConfig>('/api/attest/starknet/config')
      .then(data => {
        if (!alive) return
        setConfig(data)
      })
      .catch(err => {
        if (!alive) return
        const message = err instanceof Error ? err.message : 'Unable to load Starknet configuration.'
        setError(message)
        setConfig(null)
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return { config, error, loading }
}

export type StarknetWallet = {
  address: string
  chainId: string | number
  provider: any
  account: any
}

export async function connectStarknetWallet(): Promise<StarknetWallet | null> {
  // Prefer window.starknet for ArgentX/Braavos via starknet.js provider injection
  const anyWindow = window as any
  const provider = anyWindow?.starknet || anyWindow?.starknet_argentX || anyWindow?.starknet_braavos
  if (!provider) return null
  try {
    await provider.enable?.()
  } catch (e) {
    return null
  }
  const accounts: string[] = provider.selectedAddress ? [provider.selectedAddress] : (await provider.request({ method: 'starknet_requestAccounts' }).catch(() => []))
  const address = accounts && accounts.length ? accounts[0] : provider.selectedAddress || provider.account?.address
  const chainId = provider.chainId || provider.network?.chainId || 'SN_SEPOLIA'
  if (!address) return null
  return { address, chainId, provider, account: provider.account || null }
}

export async function starknetMintViaWallet(
  releaseId: number,
  toAddress: string,
  metadataUri: string,
  config: StarknetConfig,
): Promise<StarknetMintResult> {
  // We do NOT perform contract call here; wallet should produce tx hash via dapp call.
  // Minimal approach: open wallet to sign an invoke for mint(to, uri) using provider.request if available.
  // However, to keep server trust-minimized, we accept only resulting tx_hash from the wallet call flow in UI.
  // This helper expects the UI to submit the tx_hash once obtained; here we just return demo path.
  const explorerUrl = buildExplorerUrl(config.explorer_tx_base || null, 'demo')
  return {
    txHash: 'demo',
    explorerUrl,
    mode: 'demo',
    metadataUri,
    tokenId: null,
  }
}


