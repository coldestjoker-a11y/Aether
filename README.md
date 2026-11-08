# AetherVault — Production Multi-Chain DeFi Wallet & DEX Aggregator

AetherVault is a high-performance, non-custodial Web3 DeFi wallet and Progressive Web App (PWA) engineered for ultra-low-latency Mainnet execution. Built with **Next.js 14**, **Viem**, **Tailwind CSS**, **Framer Motion**, and **Zustand**.

## Core Architecture & Key Features

### 1. Hardware-Accelerated Cryptography & Zero-Lag Onboarding
- **Standard BIP-39 / BIP-44 Derivation:** 12-word mnemonic generation with canonical `m/44'/60'/0'/0/0` EVM derivation (100% compatible with MetaMask, Ledger, and TrustWallet).
- **Pre-Warmed WebCrypto Vault:** Native browser `PBKDF2-SHA256` (120,000 OWASP iterations) + `AES-256-GCM` keystore encryption completing in `<100ms` with zero main-thread blocking.
- **WebAuthn Passkey & Biometric Binding:** Optional hardware authenticator lock alongside ephemeral session keys and throttled inactivity auto-lock.

### 2. Curated Multi-Chain Registry & Live Contract Importer
- **8 Supported Networks:** Ethereum Mainnet, BNB Smart Chain (BSC), Arbitrum One, Base, Optimism, Polygon PoS, QIE Blockchain Mainnet, and Ethereum Sepolia Testnet.
- **Noise-Free Blue-Chip Catalog:** Ships with a clean, curated set of globally recognized assets (`ETH`, `BNB`, `USDC`, `USDT`, `WBTC`, `SOL`, `QIE`, `POL`, `ARB`, `OP`, `LINK`, `UNI`).
- **On-Chain ERC-20 Resolver (`resolveOnChainERC20Token`):** Paste any `0x` contract address on any supported chain to dynamically resolve `symbol()`, `name()`, and `decimals()` via Multicall3.

### 3. Smart-Contract-Aware Gas Engine & 1-Trip Broadcasting
- **Smart Contract Recipient Detection (`getBytecode`):** Automatically detects when a destination `0x` address is a smart contract (e.g., exchange deposit contracts or smart accounts) and dynamically scales the gas limit floor (`65,000+`) to prevent `[out of gas]` reverts.
- **Automatic Native Sweep Reserve:** Dynamically carves out exact network gas requirements (`value + gasLimit * gasPrice <= nativeBalance`) when sending or swapping 100% (`MAX`) of native `BNB` or `ETH`.
- **Multi-Provider Fallback Cluster:** Resilient HTTP + WebSocket (`wss://`) transport cluster across Binance Dataseed, Alchemy, Infura, PublicNode, and LlamaRPC.
- **Non-Blocking Background Execution:** Instant modal drop-down with a persistent, cross-tab top status pill (`Swapping...` → `Completed!`) while receipts confirm in the background.

### 4. Hybrid DEX Aggregator & On-Chain Router Engine
- **LI.FI + Direct V2 Router Execution:** Routes swaps through LI.FI's Mainnet Diamond Router and falls back to direct on-chain **PancakeSwap V2** (`BSC`) and **Uniswap V2** (`ETH/Arb/Base`) router encoding (`getAmountsOut` + `swapExactTokensForETH` / `swapExactETHForTokens`) so even micro-swaps (`$0.10+`) execute genuinely on-chain.
- **Pre-Flight Simulation Guard:** Runs `eth_call` / `estimateGas` dry-runs and on-chain `decimals()` verification prior to signing to prevent reverted transactions from burning gas.

## Tech Stack
- **Framework:** Next.js 14 (App Router, TypeScript)
- **Blockchain Core:** Viem 2.x, Scure BIP-32 / BIP-39
- **State & Sync:** Zustand (with deep-equality re-render guards) + Binance & CoinGecko Live Price Streams
- **UI & Motion:** Tailwind CSS, Framer Motion (60fps GPU-accelerated sheets), Lucide Icons
- **Testing:** Vitest (Unit) & Playwright (End-to-End automation)

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm or pnpm

### Installation
```bash
npm install
```

### Environment Configuration
Copy the example environment configuration:
```bash
cp .env.example .env.local
```

### Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

### Testing
Run unit tests:
```bash
npm run test:unit
```

Run Playwright E2E browser tests:
```bash
npm run test:e2e
```

### Production Build
```bash
npm run build
npm run start
```
