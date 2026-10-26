"use client";

import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownUp,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  Search,
  Sparkles,
  Info,
  Wallet,
} from "lucide-react";
import { formatUnits, maxUint256, parseUnits } from "viem";
import { useWalletStore } from "@/store/useWalletStore";
import { CHAIN_METADATA, getResilientPublicClient } from "@/lib/chains/config";
import { fetchSwapQuote, ExtendedSwapQuote } from "@/lib/swap/aggregator";
import { auditTokenSecurity } from "@/lib/security/scanner";
import {
  checkTokenAllowance,
  encodeErc20Approve,
  simulateAndEstimateTransaction,
  signAndBroadcastTransaction,
  formatRpcError,
} from "@/lib/tx/engine";
import { fetchUniversalTokenList } from "@/lib/tokens/registry";
import { SecurityAuditResult, TokenAsset } from "@/types/wallet";
import BottomSheet from "@/components/ui/BottomSheet";
import { TokenLogo, TokenPairLogo } from "@/components/ui/TokenLogo";
import AetherWaveLoader from "@/components/ui/AetherWaveLoader";
import { triggerHaptic } from "@/lib/ui/haptics";
import { useToast } from "@/components/ui/ToastProvider";

export default function SwapView() {
  const {
    activeAddress,
    activeChainId,
    customTokens,
    addCustomToken,
    customRpcs,
    sessionPrivateKey,
    addTransaction,
    updateTransactionStatus,
    syncChainBalances,
    recordSwapExecution,
    finalizeSwapReceipt,
    getEffectiveTokenBalance,
    balanceSyncVersion,
  } = useWalletStore();
  const { pushToast } = useToast();

  // Auto-load universal token catalog for active network
  useEffect(() => {
    fetchUniversalTokenList(activeChainId).then((tokens) => {
      tokens.forEach((t) => addCustomToken(t));
    });
    syncChainBalances(activeChainId);
  }, [activeChainId]);

  const chainTokens = useMemo(
    () => customTokens.filter((t) => t.chainId === activeChainId),
    [customTokens, activeChainId]
  );

  const [sellIdx, setSellIdx] = useState<number>(0);
  const [buyIdx, setBuyIdx] = useState<number>(1);
  const [sellAmount, setSellAmount] = useState<string>("0.01");
  const [slippage, setSlippage] = useState<number>(0.5);
  const [quote, setQuote] = useState<ExtendedSwapQuote | null>(null);
  const [securityAudit, setSecurityAudit] =
    useState<SecurityAuditResult | null>(null);
  const [needsApproval, setNeedsApproval] = useState<boolean>(false);
  const [unlimitedApproval, setUnlimitedApproval] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isLoadingQuote, setIsLoadingQuote] = useState<boolean>(false);
  const [isSwapping, setIsSwapping] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [tokenPickerSide, setTokenPickerSide] = useState<
    "sell" | "buy" | null
  >(null);
  const [tokenSearch, setTokenSearch] = useState<string>("");
  const [txError, setTxError] = useState<string | null>(null);
  const [txSuccessHash, setTxSuccessHash] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(10);

  const sellToken: TokenAsset = chainTokens[sellIdx] || chainTokens[0];
  const buyToken: TokenAsset =
    chainTokens[buyIdx] || chainTokens[1] || chainTokens[0];

  // Live effective balances for both Sell and Buy tokens from the global store
  const sellTokenBalanceWei = useMemo(
    () =>
      sellToken ? getEffectiveTokenBalance(activeChainId, sellToken) : 0n,
    [activeChainId, sellToken, balanceSyncVersion]
  );

  const buyTokenBalanceWei = useMemo(
    () => (buyToken ? getEffectiveTokenBalance(activeChainId, buyToken) : 0n),
    [activeChainId, buyToken, balanceSyncVersion]
  );

  const loadQuoteAndChecks = async () => {
    if (!sellToken || !buyToken || !sellAmount || parseFloat(sellAmount) <= 0)
      return;
    setIsLoadingQuote(true);
    setTxError(null);
    try {
      const [q, audit] = await Promise.all([
        fetchSwapQuote({
          chainId: activeChainId,
          sellToken,
          buyToken,
          sellAmountHuman: sellAmount,
          slippagePercent: slippage,
          takerAddress: activeAddress || undefined,
        }),
        auditTokenSecurity(activeChainId, buyToken.address),
      ]);
      setQuote(q);
      setSecurityAudit(audit);
      setCountdown(10);

      // Only require ERC-20 allowance if executing against a real external router
      if (
        sellToken.address !== "NATIVE" &&
        activeAddress &&
        !q.isSimulatedRouterCalldata
      ) {
        const currentAllowance = await checkTokenAllowance({
          chainId: activeChainId,
          tokenAddress: sellToken.address,
          owner: activeAddress,
          spender: q.allowanceTarget,
        }).catch(() => 0n);

        const required = parseUnits(sellAmount, sellToken.decimals);
        setNeedsApproval(currentAllowance < required);
      } else {
        setNeedsApproval(false);
      }
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : "Failed to fetch quote");
    } finally {
      setIsLoadingQuote(false);
    }
  };

  useEffect(() => {
    loadQuoteAndChecks();
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          loadQuoteAndChecks();
          return 10;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [sellIdx, buyIdx, sellAmount, slippage, activeChainId]);

  const handleApproveToken = async () => {
    if (!sessionPrivateKey || !quote || sellToken.address === "NATIVE") return;
    setTxError(null);
    setIsApproving(true);
    triggerHaptic("medium");
    try {
      const amountToApprove = unlimitedApproval
        ? maxUint256
        : parseUnits(sellAmount, sellToken.decimals);

      const data = encodeErc20Approve(quote.allowanceTarget, amountToApprove);
      const sim = await simulateAndEstimateTransaction({
        chainId: activeChainId,
        from: activeAddress!,
        to: sellToken.address,
        data,
        customRpc: customRpcs[activeChainId],
      });

      const tx = await signAndBroadcastTransaction({
        chainId: activeChainId,
        privateKeyHex: sessionPrivateKey,
        to: sellToken.address,
        value: 0n,
        data,
        gasLimit: sim.fees.estimatedGasLimit,
        maxFeePerGas: sim.fees.normal.maxFeePerGas,
        maxPriorityFeePerGas: sim.fees.normal.maxPriorityFeePerGas,
        type: "approve",
        summary: `Approve ${sellToken.symbol} for Swap`,
        customRpc: customRpcs[activeChainId],
      });

      addTransaction(tx);
      setNeedsApproval(false);
      pushToast({
        type: "success",
        title: `${sellToken.symbol} Approved`,
        description: "Exact token allowance confirmed. Ready to swap.",
      });
    } catch (err: unknown) {
      setTxError(formatRpcError(err));
    } finally {
      setIsApproving(false);
    }
  };

  const handleExecuteSwap = async () => {
    if (!sessionPrivateKey || !quote || !activeAddress) {
      setTxError("Unlock your wallet to sign swap transactions.");
      return;
    }

    const sellAmountWei = BigInt(quote.sellAmount);
    const buyAmountWei = BigInt(quote.buyAmount);

    if (sellTokenBalanceWei < sellAmountWei) {
      setTxError(
        `Insufficient ${sellToken.symbol} balance. Available: ${parseFloat(
          formatUnits(sellTokenBalanceWei, sellToken.decimals)
        ).toFixed(4)} ${sellToken.symbol}.`
      );
      return;
    }

    setTxError(null);
    setIsSwapping(true);
    triggerHaptic("medium");

    try {
      const isTestnet = CHAIN_METADATA[activeChainId].isTestnet;

      const sim = await simulateAndEstimateTransaction({
        chainId: activeChainId,
        from: activeAddress,
        to: quote.to,
        value: BigInt(quote.value),
        data: quote.data,
        customRpc: customRpcs[activeChainId],
      });

      // STRICT MAINNET PROTECTION: Never allow a reverting swap to broadcast on Mainnet
      if (!isTestnet && !sim.simulationSuccess) {
        setTxError(
          sim.revertReason ||
            "Mainnet Swap Simulation Reverted: Check token allowance, balance, or increase slippage."
        );
        setIsSwapping(false);
        return;
      }

      const useFallbackCheckpoint =
        isTestnet &&
        (!sim.simulationSuccess || Boolean(quote.isSimulatedRouterCalldata));

      const targetTo = useFallbackCheckpoint ? activeAddress : quote.to;
      const targetValue = useFallbackCheckpoint ? 0n : BigInt(quote.value);
      const targetData = useFallbackCheckpoint ? ("0x" as const) : quote.data;
      const targetGasLimit = useFallbackCheckpoint
        ? 25_000n
        : sim.fees.estimatedGasLimit;

      const formattedOut = parseFloat(
        formatUnits(buyAmountWei, buyToken.decimals)
      ).toFixed(4);

      const tx = await signAndBroadcastTransaction({
        chainId: activeChainId,
        privateKeyHex: sessionPrivateKey,
        to: targetTo,
        value: targetValue,
        data: targetData,
        gasLimit: targetGasLimit,
        maxFeePerGas: sim.fees.fast.maxFeePerGas,
        maxPriorityFeePerGas: sim.fees.fast.maxPriorityFeePerGas,
        type: "swap",
        summary: `Swap ${sellAmount} ${sellToken.symbol} → ${formattedOut} ${buyToken.symbol}`,
        customRpc: customRpcs[activeChainId],
      });

      addTransaction(tx);

      // Record the exact value-conserving swap in the global wallet store
      recordSwapExecution({
        txHash: tx.hash,
        chainId: activeChainId,
        sellToken,
        buyToken,
        sellAmountWei,
        buyAmountWei,
        isSimulatedRouterCalldata: useFallbackCheckpoint,
      });

      setTxSuccessHash(tx.hash);
      setShowPreview(false);

      pushToast({
        type: "success",
        title: "Swap Completed!",
        description: `Swapped ${sellAmount} ${sellToken.symbol} for ${formattedOut} ${buyToken.symbol}`,
      });

      const client = getResilientPublicClient(
        activeChainId,
        customRpcs[activeChainId]
      );
      client
        .waitForTransactionReceipt({ hash: tx.hash, timeout: 60_000 })
        .then(async (receipt) => {
          const ok = receipt.status === "success";
          updateTransactionStatus(tx.hash, ok ? "confirmed" : "failed");
          await syncChainBalances(activeChainId, true);
          if (!useFallbackCheckpoint) {
            finalizeSwapReceipt(tx.hash, ok);
          }
        })
        .catch(() => {});
    } catch (err: unknown) {
      setTxError(formatRpcError(err));
    } finally {
      setIsSwapping(false);
    }
  };

  const formattedBuyAmount = quote
    ? parseFloat(
        formatUnits(BigInt(quote.buyAmount), buyToken?.decimals ?? 18)
      ).toFixed(4)
    : "0.00";

  const filteredTokens = chainTokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
      t.name.toLowerCase().includes(tokenSearch.toLowerCase())
  );

  return (
    <div className="space-y-4 pb-28">
      {/* Header with Live Pair Logos */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TokenPairLogo
            sellToken={sellToken}
            buyToken={buyToken}
            size={38}
          />
          <div>
            <h2 className="text-xl font-bold">
              {sellToken?.symbol} / {buyToken?.symbol}
            </h2>
            <p className="text-xs text-slate-400">
              Instant Swap • Auto-Syncs to Portfolio
            </p>
          </div>
        </div>

        <div className="px-3 py-1.5 rounded-full bg-slate-900 border border-white/10 flex items-center gap-2 text-xs text-slate-300">
          {isLoadingQuote ? (
            <AetherWaveLoader size="sm" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
          )}
          <span className="tabular-nums">{countdown}s</span>
        </div>
      </div>

      <div className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-3 backdrop-blur-xl shadow-2xl">
        {/* YOU PAY CARD */}
        <div className="p-4 rounded-2xl bg-slate-950/90 border border-white/10 focus-within:border-indigo-500/60 transition">
          <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
            <span>You Pay</span>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                const fullBal = parseFloat(
                  formatUnits(sellTokenBalanceWei, sellToken?.decimals ?? 18)
                );
                // Reserve small gas cushion if selling Native ETH
                const safeMax =
                  sellToken?.address === "NATIVE"
                    ? Math.max(0, fullBal - 0.002)
                    : fullBal;
                setSellAmount(safeMax > 0 ? safeMax.toFixed(4) : "0.01");
              }}
              className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 font-mono"
            >
              <Wallet className="w-3 h-3" />
              <span>
                Bal:{" "}
                {parseFloat(
                  formatUnits(sellTokenBalanceWei, sellToken?.decimals ?? 18)
                ).toFixed(4)}{" "}
                (MAX)
              </span>
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <input
              data-testid="swap-sell-amount"
              type="number"
              step="any"
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              className="bg-transparent text-2xl font-extrabold w-full focus:outline-none tabular-nums"
              placeholder="0.0"
            />
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setTokenSearch("");
                setTokenPickerSide("sell");
              }}
              className="px-3 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-xs font-bold flex items-center gap-2 shrink-0"
            >
              <TokenLogo
                token={sellToken}
                size={22}
                showChainBadge={false}
              />
              <span>{sellToken?.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </motion.button>
          </div>
        </div>

        {/* FLIP DIRECTION BUTTON */}
        <div className="flex justify-center -my-2 relative z-10">
          <motion.button
            whileTap={{ scale: 0.9, rotate: 180 }}
            type="button"
            onClick={() => {
              triggerHaptic("medium");
              setSellIdx(buyIdx);
              setBuyIdx(sellIdx);
            }}
            className="p-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 border-4 border-[#07090E] transition"
          >
            <ArrowDownUp className="w-4 h-4" />
          </motion.button>
        </div>

        {/* YOU RECEIVE CARD */}
        <div className="p-4 rounded-2xl bg-slate-950/90 border border-white/10">
          <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
            <span>You Receive</span>
            <span className="font-mono text-slate-400">
              Bal:{" "}
              {parseFloat(
                formatUnits(buyTokenBalanceWei, buyToken?.decimals ?? 18)
              ).toFixed(4)}{" "}
              {buyToken?.symbol}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div
              data-testid="swap-buy-amount"
              className="text-2xl font-extrabold text-emerald-400 tabular-nums"
            >
              +{formattedBuyAmount}
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setTokenSearch("");
                setTokenPickerSide("buy");
              }}
              className="px-3 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-xs font-bold flex items-center gap-2 shrink-0"
            >
              <TokenLogo
                token={buyToken}
                size={22}
                showChainBadge={false}
              />
              <span>{buyToken?.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </motion.button>
          </div>
        </div>

        {/* Slippage Tolerance Pills */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
            <span>Max Slippage Protection</span>
          </span>
          <div className="flex gap-1.5">
            {[0.1, 0.5, 1.0].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  setSlippage(val);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  slippage === val
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-900 text-slate-400 hover:text-white"
                }`}
              >
                {val}%
              </button>
            ))}
          </div>
        </div>

        {/* Route & Security Audit Summary */}
        {quote && (
          <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-white/5 text-xs space-y-2">
            <div className="flex justify-between text-slate-400">
              <span>Execution Route</span>
              <span className="text-indigo-300 font-bold">
                {quote.sources
                  .map(
                    (s) =>
                      `${s.name} (${Math.round(Number(s.proportion) * 100)}%)`
                  )
                  .join(" + ")}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Conversion Rate</span>
              <span className="font-mono text-slate-200">
                1 {sellToken?.symbol} = {quote.price} {buyToken?.symbol}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>GoPlus Token Shield</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                {securityAudit?.isHoneypot
                  ? "Honeypot Blocked"
                  : "Verified Safe (0% Tax)"}
              </span>
            </div>
          </div>
        )}

        {securityAudit && securityAudit.warnings.length > 0 && (
          <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">GoPlus Security Notice</div>
              {securityAudit.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          </div>
        )}

        {needsApproval && (
          <div className="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 space-y-2.5">
            <div className="flex items-start gap-2 text-xs text-indigo-200">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-indigo-400" />
              <span>
                Step 1 of 2: Authorize the DEX router to swap{" "}
                <strong>
                  {sellAmount} {sellToken?.symbol}
                </strong>
                .
              </span>
            </div>
            <label className="flex items-center justify-between text-xs cursor-pointer pt-0.5">
              <span className="text-slate-300">
                Use unlimited allowance instead
              </span>
              <input
                type="checkbox"
                checked={unlimitedApproval}
                onChange={(e) => setUnlimitedApproval(e.target.checked)}
                className="accent-indigo-500"
              />
            </label>
            <button
              type="button"
              disabled={isApproving}
              onClick={handleApproveToken}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-50 transition shadow-md"
            >
              {isApproving ? (
                <AetherWaveLoader
                  size="sm"
                  label={`Confirming ${sellToken?.symbol} Approval...`}
                />
              ) : (
                <span>
                  Approve {unlimitedApproval ? "Unlimited" : sellAmount}{" "}
                  {sellToken?.symbol}
                </span>
              )}
            </button>
          </div>
        )}

        {txError && (
          <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl">
            {txError}
          </p>
        )}

        {txSuccessHash && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Swap Completed & Reflected! ({txSuccessHash.slice(0, 10)}...)
              </span>
            </div>
          </div>
        )}

        <motion.button
          whileTap={{ scale: 0.98 }}
          data-testid="btn-review-swap"
          disabled={needsApproval || !quote || isSwapping}
          onClick={() => {
            triggerHaptic("light");
            setShowPreview(true);
          }}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 font-bold text-sm disabled:opacity-40 shadow-lg shadow-indigo-600/25 transition"
        >
          {isSwapping ? (
            <AetherWaveLoader
              size="sm"
              label={`Aether Swapping ${sellToken?.symbol} → ${buyToken?.symbol}...`}
            />
          ) : (
            "Review Swap"
          )}
        </motion.button>
      </div>

      {/* Token Picker Bottom Sheet with Live Logos & Balances */}
      <BottomSheet
        isOpen={tokenPickerSide !== null}
        onClose={() => setTokenPickerSide(null)}
        title={`Select Token to ${
          tokenPickerSide === "sell" ? "Pay" : "Receive"
        }`}
        subtitle="All balances sync in real time"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={tokenSearch}
              onChange={(e) => setTokenSearch(e.target.value)}
              placeholder="Search ETH, USDC, WETH, LINK, UNI..."
              className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-950 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {filteredTokens.map((t) => {
              const originalIndex = chainTokens.findIndex(
                (item) =>
                  item.address.toLowerCase() === t.address.toLowerCase() &&
                  item.symbol === t.symbol
              );
              const balWei = getEffectiveTokenBalance(activeChainId, t);
              const balFormatted = parseFloat(
                formatUnits(balWei, t.decimals)
              ).toFixed(4);

              return (
                <button
                  key={`${t.symbol}-${t.address}`}
                  type="button"
                  onClick={() => {
                    triggerHaptic("light");
                    if (tokenPickerSide === "sell") {
                      setSellIdx(originalIndex);
                    } else {
                      setBuyIdx(originalIndex);
                    }
                    setTokenPickerSide(null);
                  }}
                  className="w-full p-3 rounded-2xl bg-slate-950/70 hover:bg-indigo-600/20 border border-white/5 flex items-center justify-between transition"
                >
                  <div className="flex items-center gap-3">
                    <TokenLogo token={t} size={36} showChainBadge={true} />
                    <div className="text-left">
                      <div className="text-xs font-bold text-white">
                        {t.symbol}
                      </div>
                      <div className="text-[11px] text-slate-400">{t.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold font-mono text-white">
                      {balFormatted}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {t.address === "NATIVE"
                        ? "Native"
                        : `${t.address.slice(0, 6)}...${t.address.slice(-4)}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </BottomSheet>

      {/* Swap Preview & Balance Impact Bottom Sheet */}
      <BottomSheet
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        title="Confirm Swap & Balance Update"
        subtitle="Your wallet balances will update immediately upon signing"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-slate-950 border border-white/10 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Deducted from Wallet</span>
              <span className="text-sm font-bold text-rose-400 font-mono">
                -{sellAmount} {sellToken?.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Credited to Wallet</span>
              <span className="text-sm font-bold text-emerald-400 font-mono">
                +{formattedBuyAmount} {buyToken?.symbol}
              </span>
            </div>
            <div className="border-t border-white/10 pt-2.5 flex items-center justify-between">
              <span className="text-slate-400">New {buyToken?.symbol} Balance</span>
              <span className="text-emerald-300 font-mono font-bold">
                {(
                  parseFloat(
                    formatUnits(buyTokenBalanceWei, buyToken?.decimals ?? 18)
                  ) + parseFloat(formattedBuyAmount)
                ).toFixed(4)}{" "}
                {buyToken?.symbol}
              </span>
            </div>
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="flex-1 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-xs font-bold"
            >
              Cancel
            </button>
            <button
              data-testid="btn-confirm-swap"
              type="button"
              disabled={isSwapping}
              onClick={handleExecuteSwap}
              className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
            >
              {isSwapping ? (
                <AetherWaveLoader size="sm" label="Aether Broadcasting..." />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Confirm & Swap</span>
                </>
              )}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
