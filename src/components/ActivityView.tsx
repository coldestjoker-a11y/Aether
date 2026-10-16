"use client";

import React, { useEffect, useState } from "react";
import {
  ExternalLink,
  Zap,
  XCircle,
  Clock,
  CheckCircle2,
  AlertOctagon,
} from "lucide-react";
import { useWalletStore } from "@/store/useWalletStore";
import { getResilientPublicClient } from "@/lib/chains/config";
import { signAndBroadcastTransaction } from "@/lib/tx/engine";
import { WalletTransaction } from "@/types/wallet";

export default function ActivityView() {
  const {
    transactions,
    sessionPrivateKey,
    addTransaction,
    updateTransactionStatus,
  } = useWalletStore();

  const [actionError, setActionError] = useState<string | null>(null);

  // Watch pending transactions for on-chain confirmation
  useEffect(() => {
    const pending = transactions.filter((t) => t.status === "pending");
    if (pending.length === 0) return;

    pending.forEach(async (tx) => {
      try {
        const client = getResilientPublicClient(tx.chainId);
        const receipt = await client.waitForTransactionReceipt({
          hash: tx.hash,
          timeout: 30_000,
        });
        updateTransactionStatus(
          tx.hash,
          receipt.status === "success" ? "confirmed" : "failed"
        );
      } catch {
        // Remains pending until mined or replaced
      }
    });
  }, [transactions]);

  // Speed-Up: Re-broadcast with same nonce and +20% bumped gas fees
  const handleSpeedUp = async (tx: WalletTransaction) => {
    if (!sessionPrivateKey) return;
    setActionError(null);
    try {
      const bumpedMaxFee = (BigInt(tx.maxFeePerGas) * 120n) / 100n;
      const bumpedPriority = (BigInt(tx.maxPriorityFeePerGas) * 120n) / 100n;

      const replacement = await signAndBroadcastTransaction({
        chainId: tx.chainId,
        privateKeyHex: sessionPrivateKey,
        to: tx.to,
        value: BigInt(tx.value),
        data: tx.data,
        gasLimit: BigInt(tx.gasLimit),
        maxFeePerGas: bumpedMaxFee,
        maxPriorityFeePerGas: bumpedPriority,
        nonce: tx.nonce,
        type: tx.type,
        summary: `[Speed-Up] ${tx.summary}`,
      });

      updateTransactionStatus(tx.hash, "replaced");
      addTransaction(replacement);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Speed-up failed");
    }
  };

  // Cancel: Send 0 ETH to self with identical nonce and +20% bumped gas fees
  const handleCancel = async (tx: WalletTransaction) => {
    if (!sessionPrivateKey) return;
    setActionError(null);
    try {
      const bumpedMaxFee = (BigInt(tx.maxFeePerGas) * 120n) / 100n;
      const bumpedPriority = (BigInt(tx.maxPriorityFeePerGas) * 120n) / 100n;

      const cancelTx = await signAndBroadcastTransaction({
        chainId: tx.chainId,
        privateKeyHex: sessionPrivateKey,
        to: tx.from,
        value: 0n,
        data: "0x",
        gasLimit: 21_000n,
        maxFeePerGas: bumpedMaxFee,
        maxPriorityFeePerGas: bumpedPriority,
        nonce: tx.nonce,
        type: "cancel",
        summary: `Cancel Nonce #${tx.nonce}`,
      });

      updateTransactionStatus(tx.hash, "cancelled");
      addTransaction(cancelTx);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  return (
    <div className="space-y-4 pb-24">
      <h2 className="text-xl font-bold">Real-Time Activity</h2>

      {actionError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
          {actionError}
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="p-8 rounded-3xl bg-vault-card border border-vault-border text-center text-xs text-slate-400">
          No transactions yet. Broadcast a Send or Swap on Sepolia Testnet to inspect live receipts.
        </div>
      ) : (
        <div className="space-y-3">
          {transactions.map((tx) => (
            <div
              key={tx.hash}
              className="p-4 rounded-2xl bg-vault-card border border-vault-border space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">{tx.summary}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                    tx.status === "confirmed"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : tx.status === "pending"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {tx.status === "pending" && <Clock className="w-3 h-3 animate-spin" />}
                  {tx.status === "confirmed" && <CheckCircle2 className="w-3 h-3" />}
                  {tx.status === "failed" && <AlertOctagon className="w-3 h-3" />}
                  {tx.status.toUpperCase()}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>Nonce #{tx.nonce}</span>
                <a
                  href={tx.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 flex items-center gap-1 hover:underline"
                >
                  {tx.hash.slice(0, 10)}... <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {tx.status === "pending" && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleSpeedUp(tx)}
                    className="flex-1 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 text-xs font-semibold flex items-center justify-center gap-1"
                  >
                    <Zap className="w-3.5 h-3.5" /> Speed Up (+20% Gas)
                  </button>
                  <button
                    onClick={() => handleCancel(tx)}
                    className="flex-1 py-1.5 rounded-lg bg-red-600/20 border border-red-500/40 text-red-300 text-xs font-semibold flex items-center justify-center gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Cancel Tx
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
