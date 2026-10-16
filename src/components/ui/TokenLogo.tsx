"use client";

import React, { useState, useMemo } from "react";
import { getAddress, isAddress } from "viem";
import { SupportedChainId, TokenAsset } from "@/types/wallet";
import { CHAIN_METADATA } from "@/lib/chains/config";

const TRUSTWALLET_CHAIN_SLUG: Record<SupportedChainId, string> = {
  1: "ethereum",
  11155111: "ethereum",
  56: "smartchain",
  137: "polygon",
  42161: "arbitrum",
  8453: "base",
  10: "optimism",
};

// Canonical Mainnet contract addresses for popular symbols so Sepolia testnet tokens also show real logos
const CANONICAL_SYMBOL_LOGOS: Record<string, string> = {
  ETH: "https://assets.coincap.io/assets/icons/eth@2x.png",
  WETH: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png",
  USDC: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png",
  USDT: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png",
  DAI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png",
  LINK: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png",
  UNI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984/logo.png",
  WBTC: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png",
  AAVE: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9/logo.png",
  BNB: "https://assets.coincap.io/assets/icons/bnb@2x.png",
  POL: "https://assets.coincap.io/assets/icons/matic@2x.png",
  MATIC: "https://assets.coincap.io/assets/icons/matic@2x.png",
  ARB: "https://assets.coincap.io/assets/icons/arb@2x.png",
  OP: "https://assets.coincap.io/assets/icons/op@2x.png",
  EURC: "https://assets.coingecko.com/coins/images/26045/standard/euro-coin.png",
};

interface TokenLogoProps {
  token?: Pick<TokenAsset, "symbol" | "address" | "chainId" | "logoURI">;
  size?: number;
  showChainBadge?: boolean;
}

export function TokenLogo({
  token,
  size = 40,
  showChainBadge = true,
}: TokenLogoProps) {
  const [sourceIndex, setSourceIndex] = useState(0);

  const candidateUrls = useMemo(() => {
    if (!token) return [];
    const urls: string[] = [];
    const upperSym = token.symbol.toUpperCase();

    // 1. Explicit logoURI from aggregator (LI.FI / 0x / Uniswap)
    if (token.logoURI) {
      urls.push(token.logoURI);
    }

    // 2. Canonical verified high-res icon for common tickers
    if (CANONICAL_SYMBOL_LOGOS[upperSym]) {
      urls.push(CANONICAL_SYMBOL_LOGOS[upperSym]);
    }

    // 3. TrustWallet Assets GitHub CDN by EIP-55 Checksummed Contract Address
    if (token.address && token.address !== "NATIVE" && isAddress(token.address)) {
      try {
        const checksummed = getAddress(token.address);
        const chainSlug = TRUSTWALLET_CHAIN_SLUG[token.chainId] || "ethereum";
        urls.push(
          `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chainSlug}/assets/${checksummed}/logo.png`
        );
      } catch {
        // Ignore invalid checksum
      }
    }

    // 4. Live CoinCap Symbol CDN
    urls.push(
      `https://assets.coincap.io/assets/icons/${token.symbol.toLowerCase()}@2x.png`
    );

    return urls;
  }, [token]);

  const activeUrl = candidateUrls[sourceIndex];
  const chainColor = token ? CHAIN_METADATA[token.chainId]?.color : "#6366F1";

  return (
    <div
      style={{ width: size, height: size }}
      className="relative shrink-0 select-none"
    >
      {activeUrl ? (
        <img
          src={activeUrl}
          alt={token?.symbol || "Token"}
          onError={() => setSourceIndex((i) => i + 1)}
          style={{ width: size, height: size }}
          className="rounded-full object-cover bg-slate-900 border border-white/10 shadow-sm"
        />
      ) : (
        <div
          style={{ width: size, height: size }}
          className="rounded-full bg-gradient-to-br from-indigo-500/30 to-violet-600/30 border border-indigo-500/40 flex items-center justify-center font-extrabold text-xs text-indigo-200"
        >
          {(token?.symbol || "?").slice(0, 4)}
        </div>
      )}

      {showChainBadge && token && (
        <span
          title={CHAIN_METADATA[token.chainId]?.name}
          style={{ backgroundColor: chainColor }}
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#07090E]"
        />
      )}
    </div>
  );
}

/**
 * Overlapping Dual-Icon Component for Swap Pairs (e.g., ETH / USDC)
 */
export function TokenPairLogo({
  sellToken,
  buyToken,
  size = 36,
}: {
  sellToken?: Pick<TokenAsset, "symbol" | "address" | "chainId" | "logoURI">;
  buyToken?: Pick<TokenAsset, "symbol" | "address" | "chainId" | "logoURI">;
  size?: number;
}) {
  return (
    <div className="flex items-center">
      <div className="z-10">
        <TokenLogo token={sellToken} size={size} showChainBadge={false} />
      </div>
      <div className="-ml-3 z-20">
        <TokenLogo token={buyToken} size={size} showChainBadge={true} />
      </div>
    </div>
  );
}
