import {
  createPublicClient,
  fallback,
  http,
  PublicClient,
  Chain,
} from "viem";
import {
  sepolia,
  mainnet,
  bsc,
  polygon,
  arbitrum,
  base,
  optimism,
} from "viem/chains";
import { SupportedChainId, TokenAsset } from "@/types/wallet";

export const SUPPORTED_CHAINS: Record<SupportedChainId, Chain> = {
  11155111: sepolia,
  1: mainnet,
  56: bsc,
  137: polygon,
  42161: arbitrum,
  8453: base,
  10: optimism,
};

export const CHAIN_METADATA: Record<
  SupportedChainId,
  {
    name: string;
    shortName: string;
    color: string;
    isTestnet: boolean;
    zeroXEndpoint: string;
    goPlusChainId: string;
    binanceSymbol: string;
  }
> = {
  11155111: {
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    color: "#F59E0B",
    isTestnet: true,
    zeroXEndpoint: "https://sepolia.api.0x.org",
    goPlusChainId: "11155111",
    binanceSymbol: "ETHUSDT",
  },
  1: {
    name: "Ethereum Mainnet",
    shortName: "Ethereum",
    color: "#627EEA",
    isTestnet: false,
    zeroXEndpoint: "https://api.0x.org",
    goPlusChainId: "1",
    binanceSymbol: "ETHUSDT",
  },
  56: {
    name: "BNB Smart Chain",
    shortName: "BSC",
    color: "#F3BA2F",
    isTestnet: false,
    zeroXEndpoint: "https://bsc.api.0x.org",
    goPlusChainId: "56",
    binanceSymbol: "BNBUSDT",
  },
  137: {
    name: "Polygon POS",
    shortName: "Polygon",
    color: "#8247E5",
    isTestnet: false,
    zeroXEndpoint: "https://polygon.api.0x.org",
    goPlusChainId: "137",
    binanceSymbol: "MATICUSDT",
  },
  42161: {
    name: "Arbitrum One",
    shortName: "Arbitrum",
    color: "#28A0F0",
    isTestnet: false,
    zeroXEndpoint: "https://arbitrum.api.0x.org",
    goPlusChainId: "42161",
    binanceSymbol: "ETHUSDT",
  },
  8453: {
    name: "Base",
    shortName: "Base",
    color: "#0052FF",
    isTestnet: false,
    zeroXEndpoint: "https://base.api.0x.org",
    goPlusChainId: "8453",
    binanceSymbol: "ETHUSDT",
  },
  10: {
    name: "Optimism",
    shortName: "Optimism",
    color: "#FF0420",
    isTestnet: false,
    zeroXEndpoint: "https://optimism.api.0x.org",
    goPlusChainId: "10",
    binanceSymbol: "ETHUSDT",
  },
};

export const DEFAULT_TOKENS: TokenAsset[] = [
  // Sepolia Testnet
  {
    chainId: 11155111,
    address: "NATIVE",
    symbol: "ETH",
    name: "Sepolia Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 11155111,
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    symbol: "USDC",
    name: "USD Coin (Sepolia)",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 11155111,
    address: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
    symbol: "LINK",
    name: "Chainlink Token",
    decimals: 18,
    binanceSymbol: "LINKUSDT",
  },
  // Ethereum Mainnet
  {
    chainId: 1,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 1,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 1,
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 1,
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    symbol: "UNI",
    name: "Uniswap",
    decimals: 18,
    binanceSymbol: "UNIUSDT",
  },
  // Arbitrum
  {
    chainId: 42161,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 42161,
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  // Base
  {
    chainId: 8453,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  // Polygon
  {
    chainId: 137,
    address: "NATIVE",
    symbol: "POL",
    name: "Polygon Ecosystem Token",
    decimals: 18,
    binanceSymbol: "MATICUSDT",
  },
  // BSC
  {
    chainId: 56,
    address: "NATIVE",
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    binanceSymbol: "BNBUSDT",
  },
  // Optimism
  {
    chainId: 10,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
];

function getRpcUrls(chainId: SupportedChainId, customRpc?: string): string[] {
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  const infuraKey = process.env.NEXT_PUBLIC_INFURA_KEY;
  const urls: string[] = [];

  if (customRpc) urls.push(customRpc);

  switch (chainId) {
    case 11155111:
      if (alchemyKey) urls.push(`https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`);
      if (infuraKey) urls.push(`https://sepolia.infura.io/v3/${infuraKey}`);
      urls.push("https://ethereum-sepolia-rpc.publicnode.com");
      break;
    case 1:
      if (alchemyKey) urls.push(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      if (infuraKey) urls.push(`https://mainnet.infura.io/v3/${infuraKey}`);
      urls.push("https://ethereum-rpc.publicnode.com");
      break;
    case 56:
      urls.push("https://bsc-rpc.publicnode.com");
      break;
    case 137:
      if (alchemyKey) urls.push(`https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      urls.push("https://polygon-bor-rpc.publicnode.com");
      break;
    case 42161:
      if (alchemyKey) urls.push(`https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      urls.push("https://arbitrum-one-rpc.publicnode.com");
      break;
    case 8453:
      if (alchemyKey) urls.push(`https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      urls.push("https://base-rpc.publicnode.com");
      break;
    case 10:
      if (alchemyKey) urls.push(`https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      urls.push("https://optimism-rpc.publicnode.com");
      break;
  }
  return urls;
}

const clientCache = new Map<string, PublicClient>();

export function getResilientPublicClient(
  chainId: SupportedChainId,
  customRpc?: string
): PublicClient {
  const cacheKey = `${chainId}:${customRpc || "default"}`;
  const existing = clientCache.get(cacheKey);
  if (existing) return existing;

  const chain = SUPPORTED_CHAINS[chainId];
  const urls = getRpcUrls(chainId, customRpc);

  const transports = urls.map((url) =>
    http(url, {
      retryCount: 3,
      retryDelay: 600,
      timeout: 10_000,
    })
  );

  const client = createPublicClient({
    chain,
    transport: fallback(transports, { rank: true }),
    batch: { multicall: true },
  });

  clientCache.set(cacheKey, client);
  return client;
}

/**
 * STAGE 1 VERIFICATION CHECKLIST:
 * 1. Run `npm install` and verify TypeScript compilation (`npx tsc --noEmit`).
 * 2. Inspect `next.config.mjs` headers to verify strict CSP rules are active.
 * 3. Verify `getResilientPublicClient(11155111).getBlockNumber()` resolves via Sepolia fallback RPCs even without API keys set.
 */
