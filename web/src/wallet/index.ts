import '@rainbow-me/rainbowkit/styles.css'

import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

const BASE_RPC = import.meta.env.VITE_BASE_RPC_URL || 'https://sepolia.base.org'

const queryClient = new QueryClient()

const wagmiConfig = createConfig({
  chains: [baseSepolia],
  transports: {
    [baseSepolia.id]: http(BASE_RPC),
  },
  ssr: false,
  connectors: [
    injected({ target: 'metaMask', shimDisconnect: true }),
  ],
})

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          chains={[baseSepolia]}
          modalSize="compact"
          theme={lightTheme({ accentColor: '#2563eb', borderRadius: 'medium' })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
