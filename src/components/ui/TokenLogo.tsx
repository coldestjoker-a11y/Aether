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

// High-Resolution Official CoinMarketCap Icons (including QIE Blockchain UCID #21988)
const CANONICAL_SYMBOL_LOGOS: Record<string, string> = {
  QIE: "https://s2.coinmarketcap.com/static/img/coins/64x64/21988.png",
  BTC: "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png",
  SOL: "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
  ETH: "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
  WETH: "https://s2.coinmarketcap.com/static/img/coins/64x64/2396.png",
  USDC: "https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png",
  USDT: "https://s2.coinmarketcap.com/static/img/coins/64x64/825.png",
  DAI: "https://s2.coinmarketcap.com/static/img/coins/64x64/4943.png",
  LINK: "https://s2.coinmarketcap.com/static/img/coins/64x64/1975.png",
  UNI: "https://s2.coinmarketcap.com/static/img/coins/64x64/7083.png",
  WBTC: "https://s2.coinmarketcap.com/static/img/coins/64x64/3717.png",
  AAVE: "https://s2.coinmarketcap.com/static/img/coins/64x64/7278.png",
  BNB: "https://s2.coinmarketcap.com/static/img/coins/64x64/1839.png",
  POL: "https://s2.coinmarketcap.com/static/img/coins/64x64/28321.png",
  MATIC: "https://s2.coinmarketcap.com/static/img/coins/64x64/3890.png",
  ARB: "https://s2.coinmarketcap.com/static/img/coins/64x64/11841.png",
  OP: "https://s2.coinmarketcap.com/static/img/coins/64x64/11840.png",
  EURC: "https://s2.coinmarketcap.com/static/img/coins/64x64/20641.png",
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

    // 1. Canonical CoinMarketCap High-Res Icon (Instant match for QIE #21988, BTC, SOL, ETH, USDT, USDC)
    if (CANONICAL_SYMBOL_LOGOS[upperSym]) {
      urls.push(CANONICAL_SYMBOL_LOGOS[upperSym]);
    }

    // 2. Explicit token.logoURI
    if (token.logoURI && !urls.includes(token.logoURI)) {
      urls.push(token.logoURI);
    }

    // 3. TrustWallet Assets GitHub CDN by Checksummed Contract Address
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

    // 4. CoinCap Symbol Fallback
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
          loading="eager"
          decoding="async"
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
