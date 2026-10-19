"use client";

import React, { useState, useMemo } from "react";
import { Copy, Check, CreditCard, Layers } from "lucide-react";
import { useWalletStore } from "@/store/useWalletStore";
import { CHAIN_METADATA } from "@/lib/chains/config";
import { TokenAsset } from "@/types/wallet";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { triggerHaptic } from "@/lib/ui/haptics";

export default function ReceiveDepositView({
  initialMode = "receive",
  preselectedToken,
}: {
  initialMode?: "receive" | "deposit";
  preselectedToken?: TokenAsset | null;
}) {
  const {
    activeAddress,
    activeChainId,
    customTokens,
    getTokenVaultAddress,
  } = useWalletStore();

  const chainTokens = useMemo(
    () => customTokens.filter((t) => t.chainId === activeChainId),
    [customTokens, activeChainId]
  );

  const initialIdx = useMemo(() => {
    if (!preselectedToken) return 0;
    const found = chainTokens.findIndex(
      (t) =>
        t.symbol.toUpperCase() === preselectedToken.symbol.toUpperCase() &&
        t.address.toLowerCase() === preselectedToken.address.toLowerCase()
    );
    return found >= 0 ? found : 0;
  }, [chainTokens, preselectedToken]);

  const [selectedIdx, setSelectedIdx] = useState<number>(initialIdx);
  const [mode, setMode] = useState<"receive" | "onramp" | "bridge">(
    initialMode === "deposit" ? "onramp" : "receive"
  );
  const [copiedPair, setCopiedPair] = useState(false);

  const selectedToken = chainTokens[selectedIdx] || chainTokens[0];
  const dedicatedPairAddress = selectedToken
    ? getTokenVaultAddress(selectedToken)
    : activeAddress;

  const copyPairAddr = () => {
    if (!dedicatedPairAddress) return;
    navigator.clipboard.writeText(dedicatedPairAddress);
    setCopiedPair(true);
    triggerHaptic("success");
    setTimeout(() => setCopiedPair(false), 1800);
  };

  const qrCells = Array.from({ length: 121 }, (_, idx) => {
    const addr = dedicatedPairAddress || "0x0";
    const charCode = addr.charCodeAt(idx % addr.length);
    return (charCode + idx) % 2 === 0;
  });

  return (
    <div className="space-y-4 pb-28">
      <div className="grid grid-cols-3 gap-2 p-1 rounded-2xl bg-slate-900 border border-slate-800">
        <button
          onClick={() => setMode("receive")}
          className={`py-2 rounded-xl text-xs font-bold ${
            mode === "receive" ? "bg-indigo-600 text-white" : "text-slate-400"
          }`}
        >
          Receive QR
        </button>
        <button
          onClick={() => setMode("onramp")}
          className={`py-2 rounded-xl text-xs font-bold ${
            mode === "onramp" ? "bg-indigo-600 text-white" : "text-slate-400"
          }`}
        >
          Fiat On-Ramp
        </button>
        <button
          onClick={() => setMode("bridge")}
          className={`py-2 rounded-xl text-xs font-bold ${
            mode === "bridge" ? "bg-indigo-600 text-white" : "text-slate-400"
          }`}
        >
          LI.FI Bridge
        </button>
      </div>

      {mode === "receive" && (
        <div className="p-6 rounded-3xl bg-vault-card border border-vault-border text-center space-y-4">
          {/* Asset Selector */}
          <div className="text-left">
            <label className="text-[11px] text-slate-400 block mb-1.5">
              Asset ({CHAIN_METADATA[activeChainId].name})
            </label>
            <div className="flex items-center gap-2">
              <TokenLogo token={selectedToken} size={34} showChainBadge={true} />
              <select
                value={selectedIdx}
                onChange={(e) => setSelectedIdx(Number(e.target.value))}
                className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-white"
              >
                {chainTokens.map((t, i) => (
                  <option key={`${t.symbol}-${t.address}`} value={i}>
                    {t.symbol} ({t.name})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="w-48 h-48 mx-auto p-3 rounded-2xl bg-white grid grid-cols-11 gap-0.5 shadow-xl">
            {qrCells.map((filled, i) => (
              <div
                key={i}
                className={filled ? "bg-slate-950 rounded-[1px]" : "bg-white"}
              />
            ))}
          </div>

          {/* Clean Address Row — No Labels */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs break-all text-white text-center">
            {dedicatedPairAddress}
          </div>

          <button
            onClick={copyPairAddr}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:opacity-95 font-bold text-xs flex items-center justify-center gap-2 shadow-lg"
          >
            {copiedPair ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            {copiedPair ? "Copied Address!" : "Copy Address"}
          </button>
        </div>
      )}

      {mode === "onramp" && (
        <div className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <CreditCard className="w-5 h-5 text-emerald-400" />
            <span>Transak Fiat-to-Crypto On-Ramp</span>
          </div>
          <p className="text-xs text-slate-400">
            Purchase {selectedToken?.symbol || "ETH"} directly to{" "}
            <span className="font-mono text-white">
              {dedicatedPairAddress?.slice(0, 10)}...
            </span>
          </p>
          <div className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 h-64 flex flex-col items-center justify-center p-4 text-center">
            <a
              href={`https://global-stg.transak.com/?apiKey=${
                process.env.NEXT_PUBLIC_TRANSAK_API_KEY || "staging_key"
              }&walletAddress=${dedicatedPairAddress}&cryptoCurrencyCode=${
                selectedToken?.symbol || "ETH"
              }`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 rounded-xl bg-emerald-600 font-bold text-xs"
            >
              Launch Transak Checkout →
            </a>
          </div>
        </div>
      )}

      {mode === "bridge" && (
        <div className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Layers className="w-5 h-5 text-violet-400" />
            <span>LI.FI Cross-Chain Bridge</span>
          </div>
          <p className="text-xs text-slate-400">
            Bridge assets directly to {dedicatedPairAddress?.slice(0, 8)}...
          </p>
        </div>
      )}
    </div>
  );
}
