import { Address, isAddress, parseAbi } from "viem";
import { DEFAULT_TOKENS, getResilientPublicClient } from "@/lib/chains/config";
import { SupportedChainId, TokenAsset } from "@/types/wallet";

const ERC20_METADATA_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// Comprehensive built-in catalog of top Mainnet + Sepolia Testnet assets
export const EXPANDED_CATALOG: TokenAsset[] = [
  ...DEFAULT_TOKENS,
  // Sepolia Testnet Complete Suite
  {
    chainId: 11155111,
    address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    symbol: "WETH",
    name: "Wrapped Ether (Sepolia)",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 11155111,
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    symbol: "UNI",
    name: "Uniswap (Sepolia)",
    decimals: 18,
    binanceSymbol: "UNIUSDT",
  },
  {
    chainId: 11155111,
    address: "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357",
    symbol: "DAI",
    name: "Dai Stablecoin (Sepolia)",
    decimals: 18,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 11155111,
    address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
    symbol: "USDT",
    name: "Tether USD (Sepolia)",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 11155111,
    address: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
    symbol: "EURC",
    name: "Euro Coin (Sepolia)",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 11155111,
    address: "0x29f2D40B0605204364af54EC677bD022dA425d03",
    symbol: "WBTC",
    name: "Wrapped BTC (Sepolia)",
    decimals: 8,
    binanceSymbol: "ETHUSDT",
  },

  // Ethereum Mainnet Expanded Blue-Chips
  {
    chainId: 1,
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 1,
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "WBTC",
    name: "Wrapped BTC",
    decimals: 8,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 1,
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 1,
    address: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    symbol: "LINK",
    name: "Chainlink",
    decimals: 18,
    binanceSymbol: "LINKUSDT",
  },
  {
    chainId: 1,
    address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    symbol: "AAVE",
    name: "Aave Token",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 1,
    address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
    symbol: "LDO",
    name: "Lido DAO Token",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 1,
    address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    symbol: "PEPE",
    name: "Pepe",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },

  // Arbitrum One Expanded
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
    address: "0x912CE59144191C1204E64559fe8253a0e49E6548",
    symbol: "ARB",
    name: "Arbitrum",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 42161,
    address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    symbol: "WBTC",
    name: "Wrapped BTC",
    decimals: 8,
    binanceSymbol: "ETHUSDT",
  },

  // Base Expanded
  {
    chainId: 8453,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 8453,
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
  {
    chainId: 8453,
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    symbol: "AERO",
    name: "Aerodrome Finance",
    decimals: 18,
    binanceSymbol: "USDCUSDT",
  },

  // Optimism Expanded
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
    binanceSymbol: "ETHUSDT",
  },

  // Polygon POS Expanded
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
  {
    chainId: 137,
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },

  // BNB Smart Chain Expanded
  {
    chainId: 56,
    address: "0x55d398326f99059fF775485246999027B3197955",
    symbol: "USDT",
    name: "Tether USD (BSC)",
    decimals: 18,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 56,
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    symbol: "USDC",
    name: "USD Coin (BSC)",
    decimals: 18,
    binanceSymbol: "USDCUSDT",
  },
  {
    chainId: 56,
    address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    symbol: "ETH",
    name: "Binance-Peg Ethereum",
    decimals: 18,
    binanceSymbol: "ETHUSDT",
  },
];

const remoteListCache = new Map<SupportedChainId, TokenAsset[]>();

/**
 * Dynamically fetches the full multi-chain token list from LI.FI & Uniswap registries
 * and merges it with our built-in catalog so every asset is searchable.
 */
export async function fetchUniversalTokenList(
  chainId: SupportedChainId
): Promise<TokenAsset[]> {
  const localForChain = deduplicateTokens(
    EXPANDED_CATALOG.filter((t) => t.chainId === chainId)
  );

  if (chainId === 11155111) {
    return localForChain;
  }

  const cached = remoteListCache.get(chainId);
  if (cached) return cached;

  try {
    const res = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`);
    if (!res.ok) return localForChain;

    const data = await res.json();
    const rawList = data?.tokens?.[String(chainId)] || [];

    const mapped: TokenAsset[] = rawList
      .slice(0, 250) // Top 250 liquid tokens per chain to keep memory ultra-fast
      .map(
        (item: {
          address: string;
          symbol: string;
          name: string;
          decimals: number;
          logoURI?: string;
        }) => ({
          chainId,
          address:
            item.address === "0x0000000000000000000000000000000000000000"
              ? "NATIVE"
              : (item.address as Address),
          symbol: item.symbol,
          name: item.name,
          decimals: item.decimals,
          logoURI: item.logoURI,
          binanceSymbol: `${item.symbol.toUpperCase()}USDT`,
        })
      );

    const merged = deduplicateTokens([...localForChain, ...mapped]);
    remoteListCache.set(chainId, merged);
    return merged;
  } catch {
    return localForChain;
  }
}

/**
 * Resolves ANY arbitrary ERC-20 contract address directly from the blockchain
 * so users can paste any newly deployed token address and immediately add/swap/send it.
 */
export async function resolveOnChainERC20Token(
  chainId: SupportedChainId,
  contractAddress: string,
  customRpc?: string
): Promise<TokenAsset | null> {
  const cleaned = contractAddress.trim();
  if (!isAddress(cleaned)) return null;

  try {
    const client = getResilientPublicClient(chainId, customRpc);
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({
        address: cleaned as Address,
        abi: ERC20_METADATA_ABI,
        functionName: "symbol",
      }),
      client.readContract({
        address: cleaned as Address,
        abi: ERC20_METADATA_ABI,
        functionName: "name",
      }),
      client.readContract({
        address: cleaned as Address,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
      }),
    ]);

    return {
      chainId,
      address: cleaned as Address,
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
    const key = `${t.chainId}:${t.address.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

