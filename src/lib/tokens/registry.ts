import { Address, isAddress, parseAbi } from "viem";
import { DEFAULT_TOKENS, getResilientPublicClient } from "@/lib/chains/config";
import { SupportedChainId, TokenAsset } from "@/types/wallet";

const ERC20_METADATA_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// Official CoinMarketCap Icon for QIE Blockchain (https://coinmarketcap.com/currencies/qi-blockchain/ -> UCID 21988)
export const OFFICIAL_QIE_CMC_LOGO =
  "https://s2.coinmarketcap.com/static/img/coins/64x64/21988.png";

export const EXPANDED_CATALOG: TokenAsset[] = [
  // Sepolia Testnet Featured Pairs: QIE/USDT, BTC/USD, SOL/USD
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
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 8,
    coingeckoId: "bitcoin",
    binanceSymbol: "BTCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png",
  },
  {
    chainId: 11155111,
    address: "0xD31a59c85aE9D8edEFeC411D448f90841571b89c",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    coingeckoId: "solana",
    binanceSymbol: "SOLUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
  },
  {
    chainId: 11155111,
    address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
    symbol: "USDT",
    name: "Tether USD (Sepolia)",
    decimals: 6,
    binanceSymbol: "USDCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/825.png",
  },
  ...DEFAULT_TOKENS,
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

  // Ethereum Mainnet QIE Blockchain, BTC, SOL & Blue-Chips
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
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 8,
    coingeckoId: "bitcoin",
    binanceSymbol: "BTCUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png",
  },
  {
    chainId: 1,
    address: "0xD31a59c85aE9D8edEFeC411D448f90841571b89c",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    coingeckoId: "solana",
    binanceSymbol: "SOLUSDT",
    logoURI: "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
  },
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
];

const remoteListCache = new Map<SupportedChainId, TokenAsset[]>();

export async function fetchUniversalTokenList(
  chainId: SupportedChainId
): Promise<TokenAsset[]> {
  const localForChain = deduplicateTokens(
    EXPANDED_CATALOG.filter((t) => t.chainId === chainId)
  );

  // Return local catalog immediately on Sepolia so onboarding & dashboard load in 0ms
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
      .slice(0, 80)
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
    const key = `${t.chainId}:${t.symbol.toUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
