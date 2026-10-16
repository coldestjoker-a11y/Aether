"use client";

import React, { useState } from "react";
import { Copy, Check, CreditCard, Layers } from "lucide-react";
import { useWalletStore } from "@/store/useWalletStore";
import { CHAIN_METADATA } from "@/lib/chains/config";

export default function ReceiveDepositView({
  initialMode = "receive",
}: {
  initialMode?: "receive" | "deposit";
}) {
  const { activeAddress, activeChainId } = useWalletStore();
  const [mode, setMode] = useState<"receive" | "onramp" | "bridge">(
    initialMode === "deposit" ? "onramp" : "receive"
  );
  const [copied, setCopied] = useState(false);

  const copyAddr = () => {
    if (!activeAddress) return;
    navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Deterministic visual QR matrix from address bytes
  const qrCells = Array.from({ length: 121 }, (_, idx) => {
    const charCode = (activeAddress || "0x0").charCodeAt(
      idx % (activeAddress?.length || 1)
    );
    return (charCode + idx) % 2 === 0;
  });

  return (
    <div className="space-y-4 pb-24">
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
          <div className="text-xs font-semibold text-indigo-400">
            Receive on {CHAIN_METADATA[activeChainId].name}
          </div>

          <div className="w-48 h-48 mx-auto p-3 rounded-2xl bg-white grid grid-cols-11 gap-0.5">
            {qrCells.map((filled, i) => (
              <div
                key={i}
                className={filled ? "bg-slate-950 rounded-[1px]" : "bg-white"}
              />
            ))}
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs break-all">
            {activeAddress}
          </div>

          <button
            onClick={copyAddr}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-xs flex items-center justify-center gap-2"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Address Copied!" : "Copy Wallet Address"}
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
            Purchase ETH or USDC directly to{" "}
            <span className="font-mono text-white">
              {activeAddress?.slice(0, 8)}...
            </span>{" "}
            via Apple Pay, Card, or Bank Transfer.
          </p>
          <div className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 h-80 flex flex-col items-center justify-center p-4 text-center">
            <p className="text-xs text-slate-300 mb-3">
              Transak Widget Target URL Ready:
            </p>
            <a
              href={`https://global-stg.transak.com/?apiKey=${
                process.env.NEXT_PUBLIC_TRANSAK_API_KEY || "staging_key"
              }&walletAddress=${activeAddress}&cryptoCurrencyCode=ETH`}
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
            Bridge assets across Ethereum, Arbitrum, Optimism, Base, Polygon, and BSC via LI.FI routing.
          </p>
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Aggregator Endpoint:</span>
              <span className="font-mono text-indigo-300">https://li.quest/v1/quote</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Destination Chain:</span>
              <span className="font-bold">{CHAIN_METADATA[activeChainId].name}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * STAGE 4 VERIFICATION CHECKLIST:
 * 1. Navigate to Swap: verify the 10-second countdown refreshes the 0x quote and displays Uniswap_V3 + Curve route split.
 * 2. Navigate to Send: enter a new 0x address and verify the amber "First-time recipient detected!" warning banner appears.
 */
