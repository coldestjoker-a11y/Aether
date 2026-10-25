import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  webSocket,
  PublicClient,
  Chain,
  Transport,
} from "viem";
import {
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
  bsc,
  sepolia,
} from "viem/chains";
import { SupportedChainId, TokenAsset } from "@/types/wallet";

// Official QIE Blockchain Mainnet Definition
export const qieMainnet = defineChain({
  id: 5656,
  name: "QIE Blockchain Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc-main1.qiblockchain.online"],
    },
  },
  blockExplorers: {
    default: {
      name: "QIE Explorer",
      url: "https://mainnet.qiblockchain.online",
    },
  },
});

export const SUPPORTED_CHAINS: Record<SupportedChainId, Chain> = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
  137: polygon,
  56: bsc,
  5656: qieMainnet,
  11155111: sepolia,
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
    wethAddress: `0x${string}`;
  }
> = {
  1: {
    name: "Ethereum Mainnet",
    shortName: "Ethereum",
    color: "#627EEA",
    isTestnet: false,
    zeroXEndpoint: "https://api.0x.org",
    goPlusChainId: "1",
    binanceSymbol: "ETHUSDT",
    wethAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  42161: {
    name: "Arbitrum One",
    shortName: "Arbitrum",
    color: "#28A0F0",
    isTestnet: false,
    zeroXEndpoint: "https://arbitrum.api.0x.org",
    goPlusChainId: "42161",
    binanceSymbol: "ETHUSDT",
    wethAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  },
  8453: {
    name: "Base Mainnet",
    shortName: "Base",
    color: "#0052FF",
    isTestnet: false,
    zeroXEndpoint: "https://base.api.0x.org",
    goPlusChainId: "8453",
    binanceSymbol: "ETHUSDT",
    wethAddress: "0x4200000000000000000000000000000000000006",
  },
  10: {
    name: "Optimism Mainnet",
    shortName: "Optimism",
    color: "#FF0420",
    isTestnet: false,
    zeroXEndpoint: "https://optimism.api.0x.org",
    goPlusChainId: "10",
    binanceSymbol: "ETHUSDT",
    wethAddress: "0x4200000000000000000000000000000000000006",
  },
  137: {
    name: "Polygon POS",
    shortName: "Polygon",
    color: "#8247E5",
    isTestnet: false,
    zeroXEndpoint: "https://polygon.api.0x.org",
    goPlusChainId: "137",
    binanceSymbol: "MATICUSDT",
    wethAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  },
  56: {
    name: "BNB Smart Chain",
    shortName: "BSC",
    color: "#F3BA2F",
    isTestnet: false,
    zeroXEndpoint: "https://bsc.api.0x.org",
    goPlusChainId: "56",
    binanceSymbol: "BNBUSDT",
    wethAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  },
  5656: {
    name: "QIE Mainnet",
    shortName: "QIE Chain",
    color: "#10B981",
    isTestnet: false,
    zeroXEndpoint: "https://api.0x.org",
    goPlusChainId: "5656",
    binanceSymbol: "QIEUSDT",
    wethAddress: "0x91E000000000000000000000000000000000091E",
  },
  11155111: {
    name: "Ethereum Sepolia (Testnet)",
    shortName: "Sepolia",
    color: "#F59E0B",
    isTestnet: true,
    zeroXEndpoint: "https://sepolia.api.0x.org",
    goPlusChainId: "11155111",
    binanceSymbol: "ETHUSDT",
    wethAddress: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  },
};

export const DEFAULT_TOKENS: TokenAsset[] = [
  // Ethereum Mainnet (Default Boot Network)
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
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "BTC",
    name: "Bitcoin (WBTC)",
    decimals: 8,
    binanceSymbol: "BTCUSDT",
  },
  {
    chainId: 1,
    address: "0xD31a59c85aE9D8edEFeC411D448f90841571b89c",
    symbol: "SOL",
    name: "Solana (Wormhole)",
    decimals: 9,
    binanceSymbol: "SOLUSDT",
  },
  {
    chainId: 1,
    address: "0x91E000000000000000000000000000000000091E",
    symbol: "QIE",
    name: "QIE Blockchain",
    decimals: 18,
    binanceSymbol: "QIEUSDT",
  },
  {
    chainId: 1,
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    symbol: "UNI",
    name: "Uniswap",
    decimals: 18,
    binanceSymbol: "UNIUSDT",
  },
  // Arbitrum One Mainnet
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
  // Base Mainnet
  {
    chainId: 8453,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 8453,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  // Optimism Mainnet
  {
    chainId: 10,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  // Polygon Mainnet
  {
    chainId: 137,
    address: "NATIVE",
    symbol: "POL",
    name: "Polygon Ecosystem Token",
    decimals: 18,
    binanceSymbol: "MATICUSDT",
  },
  // BNB Smart Chain Mainnet
  {
    chainId: 56,
    address: "NATIVE",
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    binanceSymbol: "BNBUSDT",
  },
  // QIE Blockchain Mainnet
  {
    chainId: 5656,
    address: "NATIVE",
    symbol: "QIE",
    name: "QIE Native Coin",
    decimals: 18,
    binanceSymbol: "QIEUSDT",
  },
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
];

function getRpcTransports(
  chainId: SupportedChainId,
  customRpc?: string
): Transport[] {
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  const infuraKey = process.env.NEXT_PUBLIC_INFURA_KEY;
  const httpUrls: string[] = [];
  const wssUrls: string[] = [];

  if (customRpc) {
    if (customRpc.startsWith("wss://")) wssUrls.push(customRpc);
    else httpUrls.push(customRpc);
  }

  switch (chainId) {
    case 1:
      if (alchemyKey) {
        wssUrls.push(`wss://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`);
        httpUrls.push(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      }
      if (infuraKey) {
        wssUrls.push(`wss://mainnet.infura.io/ws/v3/${infuraKey}`);
        httpUrls.push(`https://mainnet.infura.io/v3/${infuraKey}`);
      }
      wssUrls.push("wss://ethereum-rpc.publicnode.com");
      httpUrls.push(
        "https://ethereum-rpc.publicnode.com",
        "https://1rpc.io/eth"
      );
      break;
    case 42161:
      if (alchemyKey) {
        wssUrls.push(`wss://arb-mainnet.g.alchemy.com/v2/${alchemyKey}`);
        httpUrls.push(`https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      }
      wssUrls.push("wss://arbitrum-one-rpc.publicnode.com");
      httpUrls.push(
        "https://arbitrum-one-rpc.publicnode.com",
        "https://1rpc.io/arb"
      );
      break;
    case 8453:
      if (alchemyKey) {
        wssUrls.push(`wss://base-mainnet.g.alchemy.com/v2/${alchemyKey}`);
        httpUrls.push(`https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      }
      wssUrls.push("wss://base-rpc.publicnode.com");
      httpUrls.push("https://base-rpc.publicnode.com", "https://1rpc.io/base");
      break;
    case 10:
      if (alchemyKey) {
        wssUrls.push(`wss://opt-mainnet.g.alchemy.com/v2/${alchemyKey}`);
        httpUrls.push(`https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      }
      wssUrls.push("wss://optimism-rpc.publicnode.com");
      httpUrls.push(
        "https://optimism-rpc.publicnode.com",
        "https://1rpc.io/op"
      );
      break;
    case 137:
      if (alchemyKey) {
        wssUrls.push(`wss://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`);
        httpUrls.push(`https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`);
      }
      wssUrls.push("wss://polygon-bor-rpc.publicnode.com");
      httpUrls.push(
        "https://polygon-bor-rpc.publicnode.com",
        "https://1rpc.io/matic"
      );
      break;
    case 56:
      wssUrls.push("wss://bsc-rpc.publicnode.com");
      httpUrls.push("https://bsc-rpc.publicnode.com", "https://1rpc.io/bnb");
      break;
    case 5656:
      httpUrls.push("https://rpc-main1.qiblockchain.online");
      break;
    case 11155111:
      if (alchemyKey) {
        wssUrls.push(`wss://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`);
        httpUrls.push(`https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`);
      }
      if (infuraKey) {
        httpUrls.push(`https://sepolia.infura.io/v3/${infuraKey}`);
      }
      wssUrls.push("wss://ethereum-sepolia-rpc.publicnode.com");
      httpUrls.push(
        "https://ethereum-sepolia-rpc.publicnode.com",
        "https://1rpc.io/sepolia"
      );
      break;
  }

  const transports: Transport[] = [];

  // Prioritize HTTP for fast Multicall3 batching, and include WebSocket in browser for real-time subscriptions
  httpUrls.forEach((url) =>
    transports.push(
      http(url, {
        retryCount: 2,
        retryDelay: 400,
        timeout: 8_000,
      })
    )
  );

  if (typeof window !== "undefined") {
    wssUrls.forEach((url) =>
      transports.push(
        webSocket(url, {
          retryCount: 2,
          reconnect: true,
        })
      )
    );
  }

  return transports;
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
  const transports = getRpcTransports(chainId, customRpc);

  const client = createPublicClient({
    chain,
    transport: fallback(transports, { rank: false }),
    batch: { multicall: true },
  });

  clientCache.set(cacheKey, client);
  return client;
}
