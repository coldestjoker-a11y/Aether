"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  ExternalLink,
  Zap,
  XCircle,
  Clock,
  CheckCircle2,
  AlertOctagon,
  ArrowDownLeft,
  ArrowUpRight,
  Repeat,
  Copy,
  Check,
  ChevronRight,
  Hash,
  Calendar,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { formatGwei, formatUnits } from "viem";
import { useWalletStore } from "@/store/useWalletStore";
import {
  CHAIN_METADATA,
  getResilientPublicClient,
} from "@/lib/chains/config";
import { signAndBroadcastTransaction, formatRpcError } from "@/lib/tx/engine";
import { decodeAetherTransferPayload } from "@/lib/crypto/assetAddresses";
import { WalletTransaction } from "@/types/wallet";
import BottomSheet from "@/components/ui/BottomSheet";
import AetherWaveLoader from "@/components/ui/AetherWaveLoader";
import { triggerHaptic, formatFriendlyAddress } from "@/lib/ui/haptics";
import { useToast } from "@/components/ui/ToastProvider";

interface ParsedTxMetadata {
  txId: string;
  direction: "IN" | "OUT" | "SWAP";
  displayAmount: string;
  symbol: string;
  formattedDate: string;
  formattedTime: string;
  networkFeeEth: string;
  swapPaidDetail?: string;
  swapReceivedDetail?: string;
  swapRateDetail?: string;
}

/**
 * Pure, zero-latency helper that extracts the exact human-readable token amount,
 * symbol, direction, date/time, and deterministic Transaction ID without making any RPC calls.
 */
function parseTransactionMetadata(
  tx: WalletTransaction,
  activeAddress?: string | null,
  customTokens?: Array<{ symbol: string; decimals: number; address: string }>
): ParsedTxMetadata {
  const dateObj = new Date(tx.timestamp);
  const formattedDate = dateObj.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const formattedTime = dateObj.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Deterministic, human-friendly Transaction ID
  const txId = `AV-${tx.chainId}-${tx.nonce}-${tx.hash.slice(2, 8).toUpperCase()}`;

  const isIncoming =
    tx.summary.toUpperCase().includes("[INCOMING]") ||
    (activeAddress &&
      tx.to.toLowerCase() === activeAddress.toLowerCase() &&
      tx.from.toLowerCase() !== activeAddress.toLowerCase());

  const direction: "IN" | "OUT" | "SWAP" =
    tx.type === "swap" ? "SWAP" : isIncoming ? "IN" : "OUT";

  // Check for rich Swap summary: "Swap <amt> <sym> → <amt> <sym> (@ 1 <sym> = <rate> <sym>)"
  if (direction === "SWAP") {
    const swapFullMatch = tx.summary.match(
      /Swap\s+([0-9.]+)\s+([A-Za-z0-9]+)\s*(?:→|->|to)\s*([0-9.]+)\s+([A-Za-z0-9]+)(?:\s*\((?:@\s*)?([^)]+)\))?/i
    );
    if (swapFullMatch) {
      const paid = `${swapFullMatch[1]} ${swapFullMatch[2]}`;
      const rec = `${swapFullMatch[3]} ${swapFullMatch[4]}`;
      const rate = swapFullMatch[5]
        ? swapFullMatch[5].startsWith("@")
          ? swapFullMatch[5]
          : `@ ${swapFullMatch[5]}`
        : `1 ${swapFullMatch[2]} ≈ ${(
            parseFloat(swapFullMatch[3]) /
            (parseFloat(swapFullMatch[1]) || 1)
          ).toFixed(4)} ${swapFullMatch[4]}`;

      return {
        txId,
        direction: "SWAP",
        displayAmount: `${paid} → ${rec}`,
        symbol: "",
        formattedDate,
        formattedTime,
        networkFeeEth: computeGasFeeString(tx),
        swapPaidDetail: paid,
        swapReceivedDetail: rec,
        swapRateDetail: rate,
      };
    }
  }

  // 1. Check if the transaction carries an encoded AetherTransfer payload (`0xa3746572`)
  const decodedPayload = decodeAetherTransferPayload(tx.data);
  if (decodedPayload) {
    const matchedTok = customTokens?.find(
      (t) => t.symbol.toUpperCase() === decodedPayload.symbol.toUpperCase()
    );
    const decimals = matchedTok?.decimals ?? (decodedPayload.symbol === "USDC" || decodedPayload.symbol === "USDT" ? 6 : 18);
    const humanAmt = parseFloat(
      formatUnits(decodedPayload.amountWei, decimals)
    ).toFixed(4);
    return {
      txId,
      direction,
      displayAmount: `${direction === "IN" ? "+" : "-"}${humanAmt}`,
      symbol: decodedPayload.symbol,
      formattedDate,
      formattedTime,
      networkFeeEth: computeGasFeeString(tx),
    };
  }

  // 2. Parse amount & symbol from summary if present (e.g., "Send 20 USDC to..." or "Swap 0.01 ETH -> 24.65 USDC")
  const sendMatch = tx.summary.match(
    /(?:Send|Received)\s+([0-9.]+)\s+([A-Za-z0-9]+)/i
  );
  if (sendMatch) {
    return {
      txId,
      direction,
      displayAmount: `${direction === "IN" ? "+" : "-"}${sendMatch[1]}`,
      symbol: sendMatch[2].toUpperCase(),
      formattedDate,
      formattedTime,
      networkFeeEth: computeGasFeeString(tx),
    };
  }

  const incomingSymMatch = tx.summary.match(/Received\s+([A-Za-z0-9]+)/i);
  if (incomingSymMatch) {
    const sym = incomingSymMatch[1].toUpperCase();
    const matchedTok = customTokens?.find((t) => t.symbol.toUpperCase() === sym);
    const decimals =
      matchedTok?.decimals ?? (sym === "USDC" || sym === "USDT" ? 6 : 18);
    let humanAmt = "0.00";
    try {
      humanAmt = parseFloat(formatUnits(BigInt(tx.value || "0"), decimals)).toFixed(4);
    } catch {
      humanAmt = "0.00";
    }
    return {
      txId,
      direction: "IN",
      displayAmount: `+${humanAmt}`,
      symbol: sym,
      formattedDate,
      formattedTime,
      networkFeeEth: computeGasFeeString(tx),
    };
  }

  // 3. Fallback to raw `tx.value` in Native ETH
  let fallbackAmt = "0.0000";
  try {
    fallbackAmt = parseFloat(formatUnits(BigInt(tx.value || "0"), 18)).toFixed(
      4
    );
  } catch {
    fallbackAmt = "0.0000";
  }

  return {
    txId,
    direction,
    displayAmount:
      direction === "SWAP"
        ? tx.summary.replace(/^Swap\s+/i, "")
        : `${direction === "IN" ? "+" : "-"}${fallbackAmt}`,
    symbol: direction === "SWAP" ? "" : "ETH",
    formattedDate,
    formattedTime,
    networkFeeEth: computeGasFeeString(tx),
    swapPaidDetail: direction === "SWAP" ? tx.summary : undefined,
    swapReceivedDetail: direction === "SWAP" ? "Executed" : undefined,
    swapRateDetail: direction === "SWAP" ? "Market Rate" : undefined,
  };
}

function computeGasFeeString(tx: WalletTransaction): string {
  try {
    const limit = BigInt(tx.gasLimit || "21000");
    const price = BigInt(tx.maxFeePerGas || "0");
    if (price === 0n) return "0.000021 ETH";
    const feeWei = limit * price;
    return `${parseFloat(formatUnits(feeWei, 18)).toFixed(6)} ETH`;
  } catch {
    return "0.000021 ETH";
  }
}

/**
 * Memoized Single Transaction Row so list scrolling and clicking stays at a locked 60fps.
 */
const TransactionRow = React.memo(function TransactionRow({
  tx,
  meta,
  onSelect,
}: {
  tx: WalletTransaction;
  meta: ParsedTxMetadata;
  onSelect: (tx: WalletTransaction) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic("light");
        onSelect(tx);
      }}
      className="w-full p-4 rounded-2xl bg-vault-card hover:bg-slate-800/60 active:scale-[0.99] border border-vault-border transition flex items-center justify-between gap-3 text-left"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
            meta.direction === "IN"
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              : meta.direction === "SWAP"
              ? "bg-violet-500/15 text-violet-400 border border-violet-500/30"
              : "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
          }`}
        >
          {meta.direction === "IN" ? (
            <ArrowDownLeft className="w-5 h-5" />
          ) : meta.direction === "SWAP" ? (
            <Repeat className="w-5 h-5" />
          ) : (
            <ArrowUpRight className="w-5 h-5" />
          )}
        </div>

        <div className="min-w-0">
          <div className="text-xs font-bold text-white truncate">
            {tx.summary}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
            <span>{meta.formattedDate}</span>
            <span>•</span>
            <span>{meta.formattedTime}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          <div
            className={`text-xs font-extrabold font-mono ${
              meta.direction === "IN"
                ? "text-emerald-400"
                : meta.direction === "SWAP"
                ? "text-violet-300"
                : "text-white"
            }`}
          >
            {meta.displayAmount} {meta.symbol}
          </div>

          <span
            className={`inline-flex items-center gap-1 text-[10px] font-bold mt-0.5 ${
              tx.status === "confirmed"
                ? "text-emerald-400"
                : tx.status === "pending"
                ? "text-amber-300"
                : "text-rose-400"
            }`}
          >
            {tx.status === "pending" && (
              <Clock className="w-2.5 h-2.5 animate-spin" />
            )}
            {tx.status === "confirmed" && (
              <CheckCircle2 className="w-2.5 h-2.5" />
            )}
            {tx.status === "failed" && <AlertOctagon className="w-2.5 h-2.5" />}
            {tx.status.toUpperCase()}
          </span>
        </div>

        <ChevronRight className="w-4 h-4 text-slate-500" />
      </div>
    </button>
  );
});

export default function ActivityView() {
  const {
    activeAddress,
    activeChainId,
    customTokens,
    customRpcs,
    transactions,
    sessionPrivateKey,
    addTransaction,
    updateTransactionStatus,
    processInstantInboxAndBlockPayloads,
  } = useWalletStore();
  const { pushToast } = useToast();

  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null);
  const [filterType, setFilterType] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isUpdatingTx, setIsUpdatingTx] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Check for incoming transfers on mount without blocking UI
  useEffect(() => {
    processInstantInboxAndBlockPayloads(activeChainId);
  }, [activeChainId]);

  // Lightweight background watcher for pending transactions only
  useEffect(() => {
    const pending = transactions.filter((t) => t.status === "pending");
    if (pending.length === 0) return;

    pending.forEach(async (tx) => {
      try {
        const client = getResilientPublicClient(
          tx.chainId,
          customRpcs[tx.chainId]
        );
        const receipt = await client.waitForTransactionReceipt({
          hash: tx.hash,
          timeout: 30_000,
        });
        updateTransactionStatus(
          tx.hash,
          receipt.status === "success" ? "confirmed" : "failed"
        );
      } catch {
        // Remains pending
      }
    });
  }, [transactions.length]);

  // Pre-compute metadata for all transactions in memory (0ms latency)
  const txWithMeta = useMemo(() => {
    return transactions
      .map((tx) => ({
        tx,
        meta: parseTransactionMetadata(tx, activeAddress, customTokens),
      }))
      .filter((item) => {
        if (filterType === "IN") return item.meta.direction === "IN";
        if (filterType === "OUT") return item.meta.direction !== "IN";
        return true;
      });
  }, [transactions, activeAddress, customTokens, filterType]);

  const selectedMeta = useMemo(
    () =>
      selectedTx
        ? parseTransactionMetadata(selectedTx, activeAddress, customTokens)
        : null,
    [selectedTx, activeAddress, customTokens]
  );

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    triggerHaptic("success");
    setTimeout(() => setCopiedField(null), 1600);
  }, []);

  const handleSpeedUp = async (tx: WalletTransaction) => {
    if (!sessionPrivateKey) return;
    setActionError(null);
    setIsUpdatingTx(true);
    try {
      const bumpedMaxFee = (BigInt(tx.maxFeePerGas) * 125n) / 100n;
      const bumpedPriority = (BigInt(tx.maxPriorityFeePerGas) * 125n) / 100n;

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
        customRpc: customRpcs[tx.chainId],
      });

      updateTransactionStatus(tx.hash, "replaced");
      addTransaction(replacement);
      setSelectedTx(replacement);
      pushToast({
        type: "success",
        title: "Transaction Sped Up (+25% Gas)",
        description: `New Hash: ${replacement.hash.slice(0, 12)}...`,
      });
    } catch (err: unknown) {
      setActionError(formatRpcError(err));
    } finally {
      setIsUpdatingTx(false);
    }
  };

  const handleCancel = async (tx: WalletTransaction) => {
    if (!sessionPrivateKey) return;
    setActionError(null);
    setIsUpdatingTx(true);
    try {
      const bumpedMaxFee = (BigInt(tx.maxFeePerGas) * 125n) / 100n;
      const bumpedPriority = (BigInt(tx.maxPriorityFeePerGas) * 125n) / 100n;

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
        customRpc: customRpcs[tx.chainId],
      });

      updateTransactionStatus(tx.hash, "cancelled");
      addTransaction(cancelTx);
      setSelectedTx(cancelTx);
      pushToast({
        type: "info",
        title: `Cancelled Nonce #${tx.nonce}`,
        description: `Replacement Hash: ${cancelTx.hash.slice(0, 12)}...`,
      });
    } catch (err: unknown) {
      setActionError(formatRpcError(err));
    } finally {
      setIsUpdatingTx(false);
    }
  };

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Activity</h2>
          <p className="text-xs text-slate-400">
            Tap any transaction to inspect full receipt details
          </p>
        </div>

        {/* Fast Filter Pills */}
        <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-white/10">
          {(["ALL", "IN", "OUT"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setFilterType(tab);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                filterType === tab
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab === "ALL" ? "All" : tab === "IN" ? "Received" : "Sent"}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
          {actionError}
        </div>
      )}

      {txWithMeta.length === 0 ? (
        <div className="p-8 rounded-3xl bg-vault-card border border-vault-border text-center text-xs text-slate-400">
          No transactions in this view yet.
        </div>
      ) : (
        <div className="space-y-2.5">
          {txWithMeta.map(({ tx, meta }) => (
            <TransactionRow
              key={tx.hash}
              tx={tx}
              meta={meta}
              onSelect={setSelectedTx}
            />
          ))}
        </div>
      )}

      {/* Instant Transaction Inspector Bottom Sheet */}
      <BottomSheet
        isOpen={!!selectedTx && !!selectedMeta}
        onClose={() => setSelectedTx(null)}
        title="Transaction Receipt"
        subtitle={
          selectedTx
            ? CHAIN_METADATA[selectedTx.chainId]?.name || "Blockchain Receipt"
            : ""
        }
      >
        {selectedTx && selectedMeta && (
          <div className="space-y-4">
            {/* Hero Amount & Status Banner */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-white/10 text-center space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-slate-900 border border-white/10">
                {selectedTx.status === "confirmed" && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
                {selectedTx.status === "pending" && (
                  <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                )}
                {selectedTx.status === "failed" && (
                  <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                )}
                <span className="uppercase tracking-wider text-slate-200">
                  {selectedMeta.direction === "IN"
                    ? "Received"
                    : selectedMeta.direction === "SWAP"
                    ? "Swap"
                    : "Sent"}{" "}
                  • {selectedTx.status}
                </span>
              </div>

              <div
                className={`text-2xl font-extrabold font-mono ${
                  selectedMeta.direction === "IN"
                    ? "text-emerald-400"
                    : "text-white"
                }`}
              >
                {selectedMeta.displayAmount} {selectedMeta.symbol}
              </div>

              <div className="text-xs text-slate-400">
                {selectedTx.summary}
              </div>
            </div>

            {/* Structured Receipt Details Grid */}
            <div className="p-4 rounded-2xl bg-slate-950/90 border border-white/10 space-y-3 text-xs">
              {/* Complete Swap Paid / Received / Rate Breakdown */}
              {selectedMeta.direction === "SWAP" && (
                <>
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-slate-400">Amount Paid (Sold)</span>
                    <span className="font-mono text-rose-400 font-bold">
                      {selectedMeta.swapPaidDetail}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-slate-400">Amount Received (Bought)</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {selectedMeta.swapReceivedDetail}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-slate-400">Execution Rate</span>
                    <span className="font-mono text-indigo-300">
                      {selectedMeta.swapRateDetail}
                    </span>
                  </div>
                </>
              )}

              {/* Date & Exact Time */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                  Date & Time
                </span>
                <span className="font-mono text-white font-semibold">
                  {selectedMeta.formattedDate} at {selectedMeta.formattedTime}
                </span>
              </div>

              {/* Unique Transaction ID */}
              <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Transaction ID
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(selectedMeta.txId, "txId")}
                  className="font-mono text-indigo-300 hover:text-white flex items-center gap-1.5 font-bold"
                >
                  <span>{selectedMeta.txId}</span>
                  {copiedField === "txId" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
              </div>

              {/* Full Transaction Hash */}
              <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-indigo-400" />
                  Transaction Hash
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(selectedTx.hash, "hash")}
                  className="font-mono text-slate-200 hover:text-white flex items-center gap-1.5"
                >
                  <span>{formatFriendlyAddress(selectedTx.hash, 6)}</span>
                  {copiedField === "hash" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
              </div>

              {/* Sender Address (From) */}
              <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
                <span className="text-slate-400">From</span>
                <button
                  type="button"
                  onClick={() => handleCopy(selectedTx.from, "from")}
                  className="font-mono text-slate-200 hover:text-white flex items-center gap-1.5"
                >
                  <span>{formatFriendlyAddress(selectedTx.from, 6)}</span>
                  {copiedField === "from" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
              </div>

              {/* Recipient Address (To) */}
              <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
                <span className="text-slate-400">To</span>
                <button
                  type="button"
                  onClick={() => handleCopy(selectedTx.to, "to")}
                  className="font-mono text-slate-200 hover:text-white flex items-center gap-1.5"
                >
                  <span>{formatFriendlyAddress(selectedTx.to, 6)}</span>
                  {copiedField === "to" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
              </div>

              {/* Network, Nonce & Gas Fee */}
              <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-violet-400" />
                  Network Fee & Nonce
                </span>
                <span className="font-mono text-slate-300">
                  {selectedMeta.networkFeeEth} (Nonce #{selectedTx.nonce})
                </span>
              </div>

              {selectedTx.maxFeePerGas &&
                BigInt(selectedTx.maxFeePerGas) > 0n && (
                  <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
                    <span className="text-slate-400">Gas Price</span>
                    <span className="font-mono text-slate-400">
                      {parseFloat(
                        formatGwei(BigInt(selectedTx.maxFeePerGas))
                      ).toFixed(2)}{" "}
                      Gwei
                    </span>
                  </div>
                )}
            </div>

            {/* Speed-Up / Cancel Controls if Pending */}
            {selectedTx.status === "pending" && (
              <div className="flex gap-2">
                {isUpdatingTx ? (
                  <div className="w-full py-2 flex justify-center">
                    <AetherWaveLoader
                      size="sm"
                      label="Broadcasting Replacement..."
                    />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSpeedUp(selectedTx)}
                      className="flex-1 py-2.5 rounded-xl bg-indigo-600/25 border border-indigo-500/40 text-indigo-300 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" /> Speed Up (+25% Gas)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancel(selectedTx)}
                      className="flex-1 py-2.5 rounded-xl bg-rose-600/20 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Cancel Tx
                    </button>
                  </>
                )}
              </div>
            )}

            {/* View on Block Explorer Button */}
            <a
              href={selectedTx.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white flex items-center justify-center gap-2 transition"
            >
              <span>View Full Receipt on Block Explorer</span>
              <ExternalLink className="w-4 h-4 text-indigo-400" />
            </a>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
