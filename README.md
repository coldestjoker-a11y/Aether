# AetherVault (Aether) - Multi-Chain DeFi Wallet

AetherVault is an institutional-grade, non-custodial Web3 DeFi wallet and Progressive Web App (PWA) built with **Next.js 14**, **Viem**, **Wagmi**, **Tailwind CSS**, and **Zustand**.

---

## Key Features

- **Bulletproof Cryptography & Security**:
  - BIP-39 12-word mnemonic seed generation and deterministic `m/44'/60'/0'/0/0` key derivation.
  - Interactive onboarding verification quiz ensuring secure mnemonic backup.
  - WebCrypto PBKDF2 (310,000 iterations) + AES-GCM 256-bit keystore encryption.
  - Ephemeral session keys with configurable inactivity auto-lock and zero plaintext leaks.

- **Universal Multi-Chain Asset Registry & On-Chain Resolution**:
  - Multi-chain support: Ethereum Mainnet, Sepolia Testnet, Arbitrum One, Base, Optimism, Polygon PoS, and BNB Smart Chain.
  - Dynamic discovery of 3,000+ verified liquid tokens via LI.FI & Uniswap registries.
  - Live on-chain contract resolver (`resolveOnChainERC20Token`): paste any `0x` contract address to query name, symbol, and decimals via multicall.

- **Guaranteed Gas Engine & Resilient Execution**:
  - Direct pending block `baseFeePerGas` inspection with EIP-1559 safety buffer formula:
    `maxFeePerGas = (baseFeePerGas * multiplier) + maxPriorityFeePerGas`
  - Dynamic priority fee floor (1.5 Gwei tip on Sepolia/Mainnet) and automatic Legacy `gasPrice` fallback on BSC.
  - Multi-provider fallback transport with automatic failover (Alchemy + Infura + PublicNode).
  - 2x gas fee deduction reserve on MAX native sends to prevent sweep failures.
  - Automatic retry and 15% gas bumping on underpriced replacement errors.
  - Granular manual custom Gwei override controls.

- **DEX Aggregator & Security Shield**:
  - Real-time swap routing with slippage protection and human-readable transaction summaries.
  - Integrated GoPlus Security API for live honeypot, transfer tax, and contract audit verification.
  - Exact allowance approval safety guard to protect user balances from router drain exploits.

---

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS + Lucide Icons + Framer Motion
- **Blockchain Core**: Viem 2.x, Wagmi 2.x, Scure BIP32/BIP39
- **State Management**: Zustand (with selective persistence)
- **Testing**: Vitest (Unit) & Playwright (End-to-End browser automation)
- **Package Manager**: pnpm

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+

### Installation

```bash
pnpm install
```

### Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env.local
```

### Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### Testing

Run unit tests:
```bash
pnpm test:unit
```

Run Playwright E2E browser tests:
```bash
pnpm test:e2e
```

### Production Build

```bash
pnpm build
pnpm start
```
