"use client";

import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownUp,
  CheckCircle2,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  Search,
  Sparkles,
  Wallet,
} from "lucide-react";
import { formatUnits, parseGwei } from "viem";
import { useWalletStore } from "@/store/useWalletStore";
import {
  CHAIN_METADATA,
  getResilientPublicClient,
} from "@/lib/chains/config";
import { fetchSwapQuote, ExtendedSwapQuote } from "@/lib/swap/aggregator";
import {
  simulateAndEstimateTransaction,
  signAndBroadcastTransaction,
  formatRpcError,
  checkTokenAllowance,
  encodeErc20Approve,
} from "@/lib/tx/engine";
import { fetchUniversalTokenList } from "@/lib/tokens/registry";
import { TokenAsset } from "@/types/wallet";
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
    syncChainBalances,
    commitConfirmedSwap,
    getEffectiveTokenBalance,
    balanceSyncVersion,
  } = useWalletStore();
  const { pushToast } = useToast();

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
  const [sellAmount, setSellAmount] = useState<string>("0.1");
  const [slippage, setSlippage] = useState<number>(0.5);
  const [quote, setQuote] = useState<ExtendedSwapQuote | null>(null);
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

  const sellTokenBalanceWei = useMemo(
    () =>
      sellToken ? getEffectiveTokenBalance(activeChainId, sellToken) : 0n,
    [activeChainId, sellToken, balanceSyncVersion]
  );

  const buyTokenBalanceWei = useMemo(
    () => (buyToken ? getEffectiveTokenBalance(activeChainId, buyToken) : 0n),
    [activeChainId, buyToken, balanceSyncVersion]
  );

  const loadQuote = async () => {
    if (!sellToken || !buyToken || !sellAmount || parseFloat(sellAmount) <= 0)
      return;
    setIsLoadingQuote(true);
    setTxError(null);
    try {
      const q = await fetchSwapQuote({
        chainId: activeChainId,
        sellToken,
        buyToken,
        sellAmountHuman: sellAmount,
        slippagePercent: slippage,
        takerAddress: activeAddress || undefined,
      });
      setQuote(q);
      setCountdown(10);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : "Failed to fetch quote");
    } finally {
      setIsLoadingQuote(false);
    }
  };

  useEffect(() => {
    const debounce = setTimeout(() => {
      loadQuote();
    }, 200);

    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          loadQuote();
          return 10;
        }
        return c - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [sellIdx, buyIdx, sellAmount, slippage, activeChainId]);

  const handleExecuteSwap = async () => {
    if (!sessionPrivateKey || !quote || !activeAddress) {
      setTxError("Unlock your wallet to sign swap transactions.");
      setShowPreview(false);
      return;
    }

    const isTestnet = CHAIN_METADATA[activeChainId].isTestnet;
    const sellAmountWei = BigInt(quote.sellAmount);
    const buyAmountWei = BigInt(quote.buyAmount);

    if (sellTokenBalanceWei < sellAmountWei) {
      setShowPreview(false);
      setTxError(
        `Insufficient ${sellToken.symbol} balance. Available: ${parseFloat(
          formatUnits(sellTokenBalanceWei, sellToken.decimals)
        ).toFixed(6)} ${sellToken.symbol}.`
      );
      return;
    }

    setTxError(null);
    setIsSwapping(true);
    triggerHaptic("medium");

    try {
      const client = getResilientPublicClient(
        activeChainId,
        customRpcs[activeChainId]
      );

      const sim = await simulateAndEstimateTransaction({
        chainId: activeChainId,
        from: activeAddress,
        to: quote.to,
        value: BigInt(quote.value),
        data: quote.data,
        customRpc: customRpcs[activeChainId],
      });

      // Step 1: On Mainnet, if selling an ERC-20 token (e.g., 0.1 USDC -> BNB), ensure router allowance is approved on-chain first
      if (!isTestnet && sellToken.address !== "NATIVE") {
        const currentAllowance = await checkTokenAllowance({
          chainId: activeChainId,
          tokenAddress: sellToken.address,
          owner: activeAddress,
          spender: quote.allowanceTarget,
        }).catch(() => 0n);

        if (currentAllowance < sellAmountWei) {
          pushToast({
            type: "info",
            title: `Approving ${sellToken.symbol} on Blockchain...`,
            description: "Confirming Step 1 of 2 on-chain...",
          });

          const approveData = encodeErc20Approve(
            quote.allowanceTarget,
            sellAmountWei
          );
          const approveTx = await signAndBroadcastTransaction({
            chainId: activeChainId,
            privateKeyHex: sessionPrivateKey,
            to: sellToken.address,
            value: 0n,
            data: approveData,
            gasLimit: 65_000n,
            maxFeePerGas: sim.fees.normal.maxFeePerGas || parseGwei("1"),
            maxPriorityFeePerGas:
              sim.fees.normal.maxPriorityFeePerGas || parseGwei("1"),
            type: "approve",
            summary: `Approve ${sellAmount} ${sellToken.symbol} for Swap`,
            customRpc: customRpcs[activeChainId],
          });

          addTransaction(approveTx);
          await client.waitForTransactionReceipt({
            hash: approveTx.hash,
            timeout: 45_000,
          });
        }
      }

      const formattedOut = parseFloat(
        formatUnits(buyAmountWei, buyToken.decimals)
      ).toFixed(6);

      const detailedSwapSummary = `Swap ${sellAmount} ${sellToken.symbol} → ${formattedOut} ${buyToken.symbol} (@ 1 ${sellToken.symbol} = ${quote.price} ${buyToken.symbol})`;

      // Step 2: Broadcast REAL On-Chain Swap Transaction
      const tx = await signAndBroadcastTransaction({
        chainId: activeChainId,
        privateKeyHex: sessionPrivateKey,
        to: quote.to,
        value: BigInt(quote.value),
        data: quote.data,
        gasLimit: isTestnet ? 25_000n : 165_000n,
        maxFeePerGas: sim.fees.normal.maxFeePerGas || parseGwei("1"),
        maxPriorityFeePerGas:
          sim.fees.normal.maxPriorityFeePerGas || parseGwei("1"),
        type: "swap",
        summary: detailedSwapSummary,
        customRpc: customRpcs[activeChainId],
      });

      addTransaction(tx);
      setShowPreview(false);
      setIsSwapping(false);

      pushToast({
        type: "info",
        title: "Swap Broadcasted On-Chain!",
        description: `Waiting for block confirmation (${tx.hash.slice(0, 10)}...)`,
      });

      // Step 3: Wait for real on-chain block confirmation before updating balances!
      const receipt = await client.waitForTransactionReceipt({
        hash: tx.hash,
        timeout: 45_000,
      });

      if (receipt.status === "success") {
        if (isTestnet) {
          commitConfirmedSwap({
            txHash: tx.hash,
            chainId: activeChainId,
            sellToken,
            buyToken,
            sellAmountWei,
            buyAmountWei,
          });
        } else {
          // On Mainnet, pull the true newly minted BNB/token balance straight from the blockchain!
          useWalletStore
            .getState()
            .updateTransactionStatus(tx.hash, "confirmed");
          await syncChainBalances(activeChainId, true);
        }
        setTxSuccessHash(tx.hash);
        triggerHaptic("success");
        pushToast({
          type: "success",
          title: "Swap Confirmed On-Chain!",
          description: `+${formattedOut} ${buyToken.symbol} confirmed in Block #${receipt.blockNumber.toString()}.`,
        });
      } else {
        useWalletStore.getState().updateTransactionStatus(tx.hash, "failed");
        setTxError("Swap transaction reverted on-chain.");
      }
    } catch (err: unknown) {
      setShowPreview(false);
      setTxError(formatRpcError(err));
    } finally {
      setIsSwapping(false);
    }
  };

  const formattedBuyAmount = quote
    ? parseFloat(
        formatUnits(BigInt(quote.buyAmount), buyToken?.decimals ?? 18)
      ).toFixed(6)
    : "0.00";

  const filteredTokens = chainTokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
      t.name.toLowerCase().includes(tokenSearch.toLowerCase())
  );

  return (
    <div className="space-y-4 pb-28">
      {/* Clean Header — No Protocol Gas Subtitle Clutter */}
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
          </div>
        </div>

        <div className="px-3 py-1.5 rounded-full bg-slate-900 border border-white/10 flex items-center gap-2 text-xs text-slate-300">
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              isLoadingQuote
                ? "animate-spin text-indigo-400"
                : "text-emerald-400"
            }`}
          />
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
                const safeMax =
                  sellToken?.address === "NATIVE"
                    ? Math.max(0, fullBal - 0.0001)
                    : fullBal;
                setSellAmount(safeMax > 0 ? String(safeMax) : "0.1");
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

        {/* FLIP BUTTON */}
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

        {/* Slippage Tolerance */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
            <span>Slippage</span>
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

        {/* Minimal Rate Line Only — No Protocol Fee Clutter */}
        {quote && (
          <div className="px-3.5 py-2.5 rounded-2xl bg-slate-900/60 border border-white/5 text-xs flex justify-between text-slate-400">
            <span>Rate</span>
            <span className="font-mono text-slate-200">
              1 {sellToken?.symbol} = {quote.price} {buyToken?.symbol}
            </span>
          </div>
        )}

        {txError && (
          <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl">
            {txError}
          </p>
        )}

        {txSuccessHash && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Swap Confirmed! ({txSuccessHash.slice(0, 10)}...)</span>
          </div>
        )}

        <motion.button
          whileTap={{ scale: 0.98 }}
          data-testid="btn-review-swap"
          disabled={!quote || isSwapping}
          onClick={() => {
            triggerHaptic("light");
            setShowPreview(true);
          }}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm disabled:opacity-40 shadow-lg shadow-indigo-600/25 transition"
        >
          Review Swap
        </motion.button>
      </div>

      {/* Token Picker Sheet */}
      <BottomSheet
        isOpen={tokenPickerSide !== null}
        onClose={() => setTokenPickerSide(null)}
        title={`Select Token to ${
          tokenPickerSide === "sell" ? "Pay" : "Receive"
        }`}
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={tokenSearch}
              onChange={(e) => setTokenSearch(e.target.value)}
              placeholder="Search ETH, USDC, USDT, BTC, SOL, QIE..."
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
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </BottomSheet>

      {/* Auto-Closing Swap Confirmation Sheet */}
      <BottomSheet
        isOpen={showPreview}
        onClose={() => {
          if (!isSwapping) setShowPreview(false);
        }}
        title="Confirm Swap"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-slate-950 border border-white/10 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">You Pay</span>
              <span className="text-sm font-bold text-rose-400 font-mono">
                -{sellAmount} {sellToken?.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">You Receive</span>
              <span className="text-sm font-bold text-emerald-400 font-mono">
                +{formattedBuyAmount} {buyToken?.symbol}
              </span>
            </div>
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              disabled={isSwapping}
              onClick={() => setShowPreview(false)}
              className="flex-1 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-xs font-bold disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              data-testid="btn-confirm-swap"
              type="button"
              disabled={isSwapping}
              onClick={handleExecuteSwap}
              className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
            >
              {isSwapping ? (
                <AetherWaveLoader size="sm" label="Broadcasting..." />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Confirm Swap</span>
                </>
              )}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
