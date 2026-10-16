import { Address } from "viem";
import { CHAIN_METADATA } from "@/lib/chains/config";
import { SecurityAuditResult, SupportedChainId } from "@/types/wallet";

/**
 * Queries GoPlus Security API to detect honeypots, high transfer taxes, or malicious contracts.
 */
export async function auditTokenSecurity(
  chainId: SupportedChainId,
  tokenAddress: Address | "NATIVE"
): Promise<SecurityAuditResult> {
  if (tokenAddress === "NATIVE") {
    return {
      isSafe: true,
      isHoneypot: false,
      buyTax: 0,
      sellTax: 0,
      isOpenSource: true,
      isProxy: false,
      warnings: [],
      riskLevel: "LOW",
    };
  }

  try {
    const goPlusChain = CHAIN_METADATA[chainId].goPlusChainId;
    const url = `https://api.gopluslabs.io/api/v1/token_security/${goPlusChain}?contract_addresses=${tokenAddress.toLowerCase()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error("GoPlus API unreachable");

    const json = await res.json();
    const info = json?.result?.[tokenAddress.toLowerCase()];

    if (!info) {
      return {
        isSafe: true,
        isHoneypot: false,
        buyTax: 0,
        sellTax: 0,
        isOpenSource: true,
        isProxy: false,
        warnings: ["Unindexed token contract on GoPlus."],
        riskLevel: "LOW",
      };
    }

    const isHoneypot = info.is_honeypot === "1";
    const buyTax = parseFloat(info.buy_tax || "0") * 100;
    const sellTax = parseFloat(info.sell_tax || "0") * 100;
    const isOpenSource = info.is_open_source === "1";
    const isProxy = info.is_proxy === "1";

    const warnings: string[] = [];
    if (isHoneypot) warnings.push("CRITICAL: Honeypot detected! Token cannot be sold.");
    if (buyTax > 10 || sellTax > 10)
      warnings.push(`High transfer tax detected (Buy: ${buyTax.toFixed(1)}%, Sell: ${sellTax.toFixed(1)}%).`);
    if (!isOpenSource) warnings.push("Contract source code is not verified.");

    const riskLevel = isHoneypot
      ? "CRITICAL"
      : buyTax > 15 || sellTax > 15
      ? "HIGH"
      : warnings.length > 0
      ? "MEDIUM"
      : "LOW";

    return {
      isSafe: !isHoneypot && riskLevel !== "CRITICAL",
      isHoneypot,
      buyTax,
      sellTax,
      isOpenSource,
      isProxy,
      warnings,
      riskLevel,
    };
  } catch {
    return {
      isSafe: true,
      isHoneypot: false,
      buyTax: 0,
      sellTax: 0,
      isOpenSource: true,
      isProxy: false,
      warnings: [],
      riskLevel: "LOW",
    };
  }
}
