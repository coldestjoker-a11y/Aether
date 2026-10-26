import { Address, getAddress, isAddress, parseAbi } from "viem";
import { getResilientPublicClient } from "@/lib/chains/config";
import { SupportedChainId, TokenAsset } from "@/types/wallet";

const ERC20_METADATA_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export const OFFICIAL_QIE_CMC_LOGO =
  "https://s2.coinmarketcap.com/static/img/coins/64x64/21988.png";

/**
 * STRICTLY CURATED GLOBAL BLUE-CHIP ASSETS ONLY.
 * No random or unknown tokens will ever clutter the wallet.
 * Users can add any additional token at any time by pasting its 0x contract address.
 */
export const EXPANDED_CATALOG: TokenAsset[] = [
  // ============================================================================
  // 1. ETHEREUM MAINNET (Chain ID: 1) — 8 Core Global Assets
  // ============================================================================
  {
    chainId: 1,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
  },
  {
    chainId: 1,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png",
  },
  {
    chainId: 1,
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/825.png",
  },
  {
    chainId: 1,
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "BTC",
    name: "Bitcoin (WBTC)",
    decimals: 8,
    binanceSymbol: "BTCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png",
  },
  {
    chainId: 1,
    address: "0xD31a59c85aE9D8edEFeC411D448f90841571b89c",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    binanceSymbol: "SOLUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
  },
  {
    chainId: 1,
    address: "0x91E000000000000000000000000000000000091E",
    symbol: "QIE",
    name: "QIE Blockchain",
    decimals: 18,
    coingeckoId: "qi-blockchain",
    binanceSymbol: "QIEUSDT",
    logoURI: OFFICIAL_QIE_CMC_LOGO,
  },
  {
    chainId: 1,
    address: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    symbol: "LINK",
    name: "Chainlink",
    decimals: 18,
    binanceSymbol: "LINKUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/1975.png",
  },
  {
    chainId: 1,
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    symbol: "UNI",
    name: "Uniswap",
    decimals: 18,
    binanceSymbol: "UNIUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/7083.png",
  },

  // ============================================================================
  // 2. ETHEREUM SEPOLIA TESTNET (Chain ID: 11155111) — 8 Core Global Assets
  // ============================================================================
  {
    chainId: 11155111,
    address: "NATIVE",
    symbol: "ETH",
    name: "Sepolia ETH",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
  },
  {
    chainId: 11155111,
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png",
  },
  {
    chainId: 11155111,
    address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/825.png",
  },
  {
    chainId: 11155111,
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 8,
    binanceSymbol: "BTCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png",
  },
  {
    chainId: 11155111,
    address: "0xD31a59c85aE9D8edEFeC411D448f90841571b89c",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    binanceSymbol: "SOLUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
  },
  {
    chainId: 11155111,
    address: "0x91E000000000000000000000000000000000091E",
    symbol: "QIE",
    name: "QIE Blockchain",
    decimals: 18,
    coingeckoId: "qi-blockchain",
    binanceSymbol: "QIEUSDT",
    logoURI: OFFICIAL_QIE_CMC_LOGO,
  },
  {
    chainId: 11155111,
    address: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
    symbol: "LINK",
    name: "Chainlink",
    decimals: 18,
    binanceSymbol: "LINKUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/1975.png",
  },
  {
    chainId: 11155111,
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    symbol: "UNI",
    name: "Uniswap",
    decimals: 18,
    binanceSymbol: "UNIUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/7083.png",
  },

  // ============================================================================
  // 3. ARBITRUM ONE (Chain ID: 42161) — Core Assets Only
  // ============================================================================
  {
    chainId: 42161,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ethereum",
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
  {
    chainId: 42161,
    address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 42161,
    address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    symbol: "BTC",
    name: "Wrapped BTC",
    decimals: 8,
    binanceSymbol: "BTCUSDT",
  },
  {
    chainId: 42161,
    address: "0x912CE59144191C1204E64559fe8253a0e49E6548",
    symbol: "ARB",
    name: "Arbitrum",
    decimals: 18,
    binanceSymbol: "ARBUSDT",
  },

  // ============================================================================
  // 4. BASE MAINNET (Chain ID: 8453) — Core Assets Only
  // ============================================================================
  {
    chainId: 8453,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ethereum",
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

  // ============================================================================
  // 5. OPTIMISM MAINNET (Chain ID: 10) — Core Assets Only
  // ============================================================================
  {
    chainId: 10,
    address: "NATIVE",
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 10,
    address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 10,
    address: "0x4200000000000000000000000000000000000042",
    symbol: "OP",
    name: "Optimism",
    decimals: 18,
    binanceSymbol: "OPUSDT",
  },

  // ============================================================================
  // 6. POLYGON POS (Chain ID: 137) — Core Assets Only
  // ============================================================================
  {
    chainId: 137,
    address: "NATIVE",
    symbol: "POL",
    name: "Polygon",
    decimals: 18,
    binanceSymbol: "MATICUSDT",
  },
  {
    chainId: 137,
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 137,
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },

  // ============================================================================
  // 7. BNB SMART CHAIN (Chain ID: 56) — Core Assets Only
  // ============================================================================
  {
    chainId: 56,
    address: "NATIVE",
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    binanceSymbol: "BNBUSDT",
  },
  {
    chainId: 56,
    address: "0x55d398326f99059fF775485246999027B3197955",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 56,
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 18,
    binanceSymbol: "USDCUSDT",
  },

  // ============================================================================
  // 8. QIE BLOCKCHAIN MAINNET (Chain ID: 5656)
  // ============================================================================
  {
    chainId: 5656,
    address: "NATIVE",
    symbol: "QIE",
    name: "QIE Blockchain",
    decimals: 18,
    coingeckoId: "qi-blockchain",
    binanceSymbol: "QIEUSDT",
    logoURI: OFFICIAL_QIE_CMC_LOGO,
  },
];

/**
 * Returns ONLY the clean, curated main pairs for the active chain.
 * Never fetches or injects random unknown tokens from third-party APIs.
 * Unknown/custom tokens ONLY appear when the user explicitly adds their contract address.
 */
export async function fetchUniversalTokenList(
  chainId: SupportedChainId
): Promise<TokenAsset[]> {
  return deduplicateTokens(
    EXPANDED_CATALOG.filter((t) => t.chainId === chainId)
  );
}

/**
 * On-Chain Contract Importer:
 * Triggered ONLY when the user manually pastes a 0x contract address to add a custom token.
 */
export async function resolveOnChainERC20Token(
  chainId: SupportedChainId,
  contractAddress: string,
  customRpc?: string
): Promise<TokenAsset | null> {
  const cleaned = contractAddress.trim();
  if (!isAddress(cleaned)) return null;
  const checksummed = getAddress(cleaned);

  try {
    const client = getResilientPublicClient(chainId, customRpc);
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({
        address: checksummed,
        abi: ERC20_METADATA_ABI,
        functionName: "symbol",
      }),
      client.readContract({
        address: checksummed,
        abi: ERC20_METADATA_ABI,
        functionName: "name",
      }),
      client.readContract({
        address: checksummed,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
      }),
    ]);

    return {
      chainId,
      address: checksummed,
      symbol: String(symbol).toUpperCase(),
      name: String(name),
      decimals: Number(decimals),
      binanceSymbol: `${String(symbol).toUpperCase()}USDT`,
      isCustom: true,
    };
  } catch {
    return null;
  }
}

function deduplicateTokens(tokens: TokenAsset[]): TokenAsset[] {
  const seen = new Set<string>();
  return tokens.filter((t) => {
    const key = `${t.chainId}:${t.symbol.toUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
