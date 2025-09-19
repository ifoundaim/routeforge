# Wallet Mint Setup (Base Sepolia)
1) Deploy or use an ERC-721 contract that exposes `safeMint(address,string)` (or change `NFT_MINT_FN`).
2) Set in .env:
   - MINT_MODE=testnet
   - BASE_RPC_URL=...
   - NFT_CONTRACT=0x...
   - NFT_ABI_PATH=contracts/erc721.abi.json
   - NFT_MINT_FN=safeMint(address,string)
3) Start web (`make web-dev`), connect your wallet, open a Release → Attest → NFT.
4) Confirm the wallet transaction; the UI shows the explorer link on success.
