"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  ShieldAlert,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Wrench,
  Zap,
  XCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Sliders,
  Search,
  Activity,
} from "lucide-react";
import {
  Address,
  formatEther,
  formatGwei,
  Hex,
  parseAbiItem,
  parseEther,
  parseGwei,
} from "viem";
import { useWalletStore } from "@/store/useWalletStore";
import {
  CHAIN_METADATA,
  getResilientPublicClient,
  SUPPORTED_CHAINS,
} from "@/lib/chains/config";
import {
  signAndBroadcastTransaction,
  formatRpcError,
} from "@/lib/tx/engine";
import { WalletTransaction } from "@/types/wallet";
import BottomSheet from "@/components/ui/BottomSheet";
import { useToast } from "@/components/ui/ToastProvider";
import { triggerHaptic } from "@/lib/ui/haptics";

const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

export default function AdminDashboardView() {
  const {
    activeAddress,
    activeChainId,
    customRpcs,
    sessionPrivateKey,
    transactions,
    addTransaction,
    updateTransactionStatus,
  } = useWalletStore();
  const { pushToast } = useToast();

  const [directionFilter, setDirectionFilter] = useState<
    "ALL" | "IN" | "OUT" | "FAILED_OR_STUCK"
  >("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isScanningChain, setIsScanningChain] = useState<boolean>(false);
  const [onChainNonce, setOnChainNonce] = useState<number>(0);
  const [pendingNonce, setPendingNonce] = useState<number>(0);

  // Repair Modal State for Failed / Stuck Transactions
  const [editingTx, setEditingTx] = useState<WalletTransaction | null>(null);
  const [repairTo, setRepairTo] = useState<string>("");
  const [repairValueEth, setRepairValueEth] = useState<string>("0");
  const [repairData, setRepairData] = useState<string>("0x");
  const [repairGasLimit, setRepairGasLimit] = useState<string>("120000");
  const [repairMaxGwei, setRepairMaxGwei] = useState<string>("25");
  const [repairPriorityGwei, setRepairPriorityGwei] = useState<string>("3");
  const [isRepairing, setIsRepairing] = useState<boolean>(false);

  // 1. Sync Account Nonces & Re-Verify All Stored Transactions On-Chain
  const syncMempoolAndIncomingLogs = async () => {
    if (!activeAddress) return;
    setIsScanningChain(true);
    try {
      const client = getResilientPublicClient(
        activeChainId,
        customRpcs[activeChainId]
      );

      const [latestCount, pendingCount, currentBlock] = await Promise.all([
        client.getTransactionCount({
          address: activeAddress,
          blockTag: "latest",
        }),
        client.getTransactionCount({
          address: activeAddress,
          blockTag: "pending",
        }),
        client.getBlockNumber(),
      ]);

      setOnChainNonce(latestCount);
      setPendingNonce(pendingCount);

      // Re-verify status of any pending/failed transactions
      await Promise.all(
        transactions
          .filter((t) => t.chainId === activeChainId)
          .map(async (tx) => {
            try {
              const receipt = await client.getTransactionReceipt({
                hash: tx.hash,
              });
              if (receipt) {
                updateTransactionStatus(
                  tx.hash,
                  receipt.status === "success" ? "confirmed" : "failed"
                );
              }
            } catch {
              // Still in mempool or dropped
            }
          })
      );

      // Scan recent blocks for Incoming ERC-20 Transfers (`to == activeAddress`)
      const fromBlock = currentBlock > 500n ? currentBlock - 500n : 0n;
      const incomingLogs = await client
        .getLogs({
          event: ERC20_TRANSFER_EVENT,
          args: { to: activeAddress },
          fromBlock,
          toBlock: currentBlock,
        })
        .catch(() => []);

      const explorerBase =
        SUPPORTED_CHAINS[activeChainId].blockExplorers?.default.url ||
        "https://sepolia.etherscan.io";

      incomingLogs.forEach((log) => {
        if (!log.transactionHash) return;
        const alreadyExists = transactions.some(
          (t) => t.hash.toLowerCase() === log.transactionHash!.toLowerCase()
        );
        if (!alreadyExists) {
          addTransaction({
            hash: log.transactionHash,
            chainId: activeChainId,
            from: (log.args.from ||
              "0x0000000000000000000000000000000000000000") as Address,
            to: activeAddress,
            value: (log.args.value || 0n).toString(),
            data: "0x",
            nonce: 0,
            maxFeePerGas: "0",
            maxPriorityFeePerGas: "0",
            gasLimit: "65000",
            type: "send",
            summary: `[INCOMING] Received Token Transfer from ${log.args.from?.slice(0, 6)}...`,
            status: "confirmed",
            timestamp: Date.now(),
            explorerUrl: `${explorerBase}/tx/${log.transactionHash}`,
          });
        }
      });
    } finally {
      setIsScanningChain(false);
    }
  };

  useEffect(() => {
    syncMempoolAndIncomingLogs();
  }, [activeAddress, activeChainId]);

  // Classify IN vs OUT transactions
  const enrichedTransactions = useMemo(() => {
    return transactions.map((tx) => {
      const isIncoming =
        tx.summary.includes("[INCOMING]") ||
        (activeAddress &&
          tx.to.toLowerCase() === activeAddress.toLowerCase() &&
          tx.from.toLowerCase() !== activeAddress.toLowerCase());
      return {
        ...tx,
        direction: isIncoming ? ("IN" as const) : ("OUT" as const),
      };
    });
  }, [transactions, activeAddress]);

  const filteredTransactions = useMemo(() => {
    return enrichedTransactions.filter((tx) => {
      if (directionFilter === "IN" && tx.direction !== "IN") return false;
      if (directionFilter === "OUT" && tx.direction !== "OUT") return false;
      if (
        directionFilter === "FAILED_OR_STUCK" &&
        tx.status !== "failed" &&
        tx.status !== "pending"
      ) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          tx.hash.toLowerCase().includes(q) ||
          tx.summary.toLowerCase().includes(q) ||
          tx.to.toLowerCase().includes(q) ||
          tx.from.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [enrichedTransactions, directionFilter, searchQuery]);

  // 1-Click Automated Repair for Failed or Stuck Transactions
  const handleOneClickAutoFix = async (tx: WalletTransaction) => {
    if (!sessionPrivateKey) {
      pushToast({
        type: "error",
        title: "Vault Locked",
        description: "Unlock wallet to sign replacement/recovery transactions.",
      });
      return;
    }

    triggerHaptic("medium");
    setIsRepairing(true);
    try {
      // Boost gas limit by +50% and priority/max fee by +40% to guarantee execution
      const boostedGasLimit = (BigInt(tx.gasLimit || "65000") * 150n) / 100n;
      const oldMaxFee = BigInt(tx.maxFeePerGas || parseGwei("15").toString());
      const oldPriority = BigInt(
        tx.maxPriorityFeePerGas || parseGwei("2").toString()
      );

      const boostedMaxFee = (oldMaxFee * 140n) / 100n;
      const boostedPriority = (oldPriority * 140n) / 100n;

      // If the transaction was pending, reuse its exact nonce to replace it; if it failed on-chain, use fresh pending nonce
      const targetNonce = tx.status === "pending" ? tx.nonce : undefined;

      const fixedTx = await signAndBroadcastTransaction({
        chainId: tx.chainId,
        privateKeyHex: sessionPrivateKey,
        to: tx.to,
        value: BigInt(tx.value || "0"),
        data: tx.data,
        gasLimit: boostedGasLimit,
        maxFeePerGas: boostedMaxFee,
        maxPriorityFeePerGas: boostedPriority,
        nonce: targetNonce,
        type: tx.type,
        summary: `[REPAIRED] ${tx.summary.replace(/^\[REPAIRED\]\s*/, "")}`,
        customRpc: customRpcs[tx.chainId],
      });

      updateTransactionStatus(tx.hash, "replaced");
      addTransaction(fixedTx);

      pushToast({
        type: "success",
        title: "Transaction Fixed & Re-Broadcasted!",
        description: `New Hash: ${fixedTx.hash.slice(0, 12)}... (Gas boosted +40%)`,
      });
    } catch (err: unknown) {
      pushToast({
        type: "error",
        title: "Auto-Fix Error",
        description: formatRpcError(err),
      });
    } finally {
      setIsRepairing(false);
    }
  };

  // Clear Stuck Mempool Nonce (Sends 0 ETH self-transfer on the exact stuck nonce)
  const handleForceUnstickNonce = async (nonceToClear: number) => {
    if (!sessionPrivateKey || !activeAddress) return;
    triggerHaptic("heavy");
    try {
      const clearTx = await signAndBroadcastTransaction({
        chainId: activeChainId,
        privateKeyHex: sessionPrivateKey,
        to: activeAddress,
        value: 0n,
        data: "0x",
        gasLimit: 21_000n,
        maxFeePerGas: parseGwei("35"),
        maxPriorityFeePerGas: parseGwei("5"),
        nonce: nonceToClear,
        type: "cancel",
        summary: `[ADMIN] Force-Clear Stuck Nonce #${nonceToClear}`,
        customRpc: customRpcs[activeChainId],
      });

      addTransaction(clearTx);
      pushToast({
        type: "success",
        title: `Nonce #${nonceToClear} Cleared`,
        description: `Broadcasted 0-ETH override (${clearTx.hash.slice(0, 10)}...)`,
      });
    } catch (err: unknown) {
      pushToast({
        type: "error",
        title: "Failed to Clear Nonce",
        description: formatRpcError(err),
      });
    }
  };

  const openCustomRepairSheet = (tx: WalletTransaction) => {
    setEditingTx(tx);
    setRepairTo(tx.to);
    try {
      setRepairValueEth(formatEther(BigInt(tx.value || "0")));
    } catch {
      setRepairValueEth("0");
    }
    setRepairData(tx.data || "0x");
    setRepairGasLimit(
      ((BigInt(tx.gasLimit || "65000") * 130n) / 100n).toString()
    );
    setRepairMaxGwei(
      parseFloat(
        formatGwei(
          (BigInt(tx.maxFeePerGas || parseGwei("15").toString()) * 135n) / 100n
        )
      ).toFixed(2)
    );
    setRepairPriorityGwei(
      parseFloat(
        formatGwei(
          (BigInt(tx.maxPriorityFeePerGas || parseGwei("2").toString()) *
            135n) /
            100n
        )
      ).toFixed(2)
    );
  };

  const submitCustomRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx || !sessionPrivateKey) return;
    setIsRepairing(true);
    try {
      const rebuilt = await signAndBroadcastTransaction({
        chainId: editingTx.chainId,
        privateKeyHex: sessionPrivateKey,
        to: repairTo as Address,
        value: parseEther(repairValueEth || "0"),
        data: (repairData || "0x") as Hex,
        gasLimit: BigInt(repairGasLimit || "120000"),
        maxFeePerGas: parseGwei(repairMaxGwei || "25"),
        maxPriorityFeePerGas: parseGwei(repairPriorityGwei || "3"),
        nonce: editingTx.status === "pending" ? editingTx.nonce : undefined,
        type: editingTx.type,
        summary: `[ADMIN FIXED] ${editingTx.summary}`,
        customRpc: customRpcs[editingTx.chainId],
      });

      updateTransactionStatus(editingTx.hash, "replaced");
      addTransaction(rebuilt);
      setEditingTx(null);

      pushToast({
        type: "success",
        title: "Custom Re-Broadcast Sent!",
        description: `Tx Hash: ${rebuilt.hash.slice(0, 14)}...`,
      });
    } catch (err: unknown) {
      pushToast({
        type: "error",
        title: "Repair Rejected",
        description: formatRpcError(err),
      });
    } finally {
      setIsRepairing(false);
    }
  };

  const stats = useMemo(() => {
    const inCount = enrichedTransactions.filter((t) => t.direction === "IN").length;
    const outCount = enrichedTransactions.filter((t) => t.direction === "OUT").length;
    const failedOrStuck = enrichedTransactions.filter(
      (t) => t.status === "failed" || t.status === "pending"
    ).length;
    return { inCount, outCount, failedOrStuck };
  }, [enrichedTransactions]);

  return (
    <div className="space-y-4 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            <span>Admin Tx Control Center</span>
          </h2>
          <p className="text-xs text-slate-400">
            Monitor all IN/OUT flows & repair failed or stuck transactions
          </p>
        </div>

        <button
          onClick={syncMempoolAndIncomingLogs}
          className="px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-xs font-bold flex items-center gap-1.5 hover:border-indigo-500 transition"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              isScanningChain ? "animate-spin text-indigo-400" : "text-emerald-400"
            }`}
          />
          <span>Sync Chain</span>
        </button>
      </div>

      {/* Live Telemetry & Nonce Health Cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-vault-card border border-white/10">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" /> Incoming (IN)
          </div>
          <div className="text-xl font-extrabold text-emerald-400 mt-1">
            {stats.inCount}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-vault-card border border-white/10">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" /> Outgoing (OUT)
          </div>
          <div className="text-xl font-extrabold text-indigo-300 mt-1">
            {stats.outCount}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-vault-card border border-white/10">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Needs Fix
          </div>
          <div className="text-xl font-extrabold text-amber-400 mt-1">
            {stats.failedOrStuck}
          </div>
        </div>
      </div>

      {/* Mempool Nonce Diagnostics Bar */}
      <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-white/10 flex items-center justify-between text-xs">
        <div className="space-y-0.5">
          <div className="font-bold text-slate-200">
            {CHAIN_METADATA[activeChainId].name} Nonce Diagnostics
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Confirmed Nonce: #{onChainNonce} • Pending Queue: #{pendingNonce}
          </div>
        </div>

        {pendingNonce > onChainNonce && (
          <button
            onClick={() => handleForceUnstickNonce(onChainNonce)}
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px]"
          >
            Unstick Nonce #{onChainNonce}
          </button>
        )}
      </div>

      {/* Filter Tabs & Search */}
      <div className="space-y-2.5">
        <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl bg-slate-900 border border-white/10">
          {(
            [
              { id: "ALL", label: "All Tx" },
              { id: "IN", label: "IN (Deposits)" },
              { id: "OUT", label: "OUT (Sent)" },
              { id: "FAILED_OR_STUCK", label: "Failed / Stuck" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDirectionFilter(tab.id)}
              className={`py-2 rounded-xl text-[11px] font-bold transition ${
                directionFilter === tab.id
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by tx hash, 0x address, or token..."
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-900/90 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Transaction Feed with Repair Controls */}
      {filteredTransactions.length === 0 ? (
        <div className="p-8 rounded-3xl bg-vault-card border border-vault-border text-center text-xs text-slate-400">
          No matching transactions found. Click &quot;Sync Chain&quot; to scan recent blocks.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTransactions.map((tx) => {
            const isProblematic =
              tx.status === "failed" || tx.status === "pending";
            return (
              <div
                key={tx.hash}
                className={`p-4 rounded-2xl bg-vault-card border space-y-3 transition ${
                  tx.status === "failed"
                    ? "border-rose-500/40"
                    : tx.status === "pending"
                    ? "border-amber-500/40"
                    : "border-white/10"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`p-2 rounded-xl ${
                        tx.direction === "IN"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-indigo-500/15 text-indigo-400"
                      }`}
                    >
                      {tx.direction === "IN" ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                            tx.direction === "IN"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-indigo-500/20 text-indigo-300"
                          }`}
                        >
                          {tx.direction}
                        </span>
                        <span className="text-xs font-bold text-white">
                          {tx.summary}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        From: {tx.from.slice(0, 6)}...{tx.from.slice(-4)} → To:{" "}
                        {tx.to.slice(0, 6)}...{tx.to.slice(-4)}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0 ${
                      tx.status === "confirmed"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : tx.status === "pending"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-rose-500/20 text-rose-400"
                    }`}
                  >
                    {tx.status === "pending" && (
                      <Clock className="w-3 h-3 animate-spin" />
                    )}
                    {tx.status === "confirmed" && (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    {tx.status === "failed" && <XCircle className="w-3 h-3" />}
                    {tx.status.toUpperCase()}
                  </span>
                </div>

                {/* Metadata Footer */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-white/5">
                  <span>
                    Nonce #{tx.nonce} •{" "}
                    {new Date(tx.timestamp).toLocaleTimeString()}
                  </span>
                  <a
                    href={tx.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 flex items-center gap-1 hover:underline"
                  >
                    {tx.hash.slice(0, 10)}...{" "}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Admin Repair Actions for Failed or Stuck Transactions */}
                {isProblematic && tx.direction === "OUT" && (
                  <div className="pt-2 flex flex-wrap gap-2">
                    <button
                      disabled={isRepairing}
                      onClick={() => handleOneClickAutoFix(tx)}
                      className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      1-Click Fix & Retry (+40% Gas)
                    </button>

                    <button
                      onClick={() => openCustomRepairSheet(tx)}
                      className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1"
                    >
                      <Wrench className="w-3.5 h-3.5 text-amber-400" />
                      Edit & Resend
                    </button>

                    {tx.status === "pending" && (
                      <button
                        onClick={() => handleForceUnstickNonce(tx.nonce)}
                        className="py-2 px-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold"
                      >
                        Cancel Nonce
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Admin Custom Transaction Repair Modal */}
      <BottomSheet
        isOpen={!!editingTx}
        onClose={() => setEditingTx(null)}
        title="Admin Transaction Repair & Override"
        subtitle="Modify gas limit, Gwei fee, or calldata and re-broadcast"
      >
        {editingTx && (
          <form onSubmit={submitCustomRepair} className="space-y-3 text-xs">
            <div>
              <label className="text-slate-400 block mb-1">
                Recipient / Contract Address (`to`)
              </label>
              <input
                type="text"
                value={repairTo}
                onChange={(e) => setRepairTo(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 font-mono"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-slate-400 block mb-1">
                  Value (Native ETH)
                </label>
                <input
                  type="number"
                  step="any"
                  value={repairValueEth}
                  onChange={(e) => setRepairValueEth(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Gas Limit</label>
                <input
                  type="number"
                  value={repairGasLimit}
                  onChange={(e) => setRepairGasLimit(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-slate-400 flex items-center gap-1 mb-1">
                  <Sliders className="w-3 h-3 text-indigo-400" /> Max Fee (Gwei)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={repairMaxGwei}
                  onChange={(e) => setRepairMaxGwei(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">
                  Priority Tip (Gwei)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={repairPriorityGwei}
                  onChange={(e) => setRepairPriorityGwei(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">
                Hex Calldata (`data`)
              </label>
              <textarea
                rows={2}
                value={repairData}
                onChange={(e) => setRepairData(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-950 border border-white/10 font-mono text-[11px]"
              />
            </div>

            <button
              type="submit"
              disabled={isRepairing}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 font-bold text-sm text-white shadow-lg"
            >
              {isRepairing
                ? "Signing & Re-Broadcasting..."
                : "Sign & Broadcast Repaired Transaction"}
            </button>
          </form>
        )}
      </BottomSheet>
    </div>
  );
}
