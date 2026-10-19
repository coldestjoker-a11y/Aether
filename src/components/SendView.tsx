"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  AlertTriangle,
  BookUser,
  CheckCircle2,
  ChevronDown,
  Gauge,
  QrCode,
  Search,
  Send,
  Sliders,
  PlusCircle,
} from "lucide-react";
import {
  Address,
  formatGwei,
  formatUnits,
  isAddress,
  parseGwei,
  parseUnits,
} from "viem";
import { normalize } from "viem/ens";
import { useWalletStore } from "@/store/useWalletStore";
import { getResilientPublicClient } from "@/lib/chains/config";
import {
  encodeErc20Transfer,
  GasFeeEstimate,
  simulateAndEstimateTransaction,
  signAndBroadcastTransaction,
  formatRpcError,
} from "@/lib/tx/engine";
import {
  fetchUniversalTokenList,
  resolveOnChainERC20Token,
} from "@/lib/tokens/registry";
import { TokenAsset } from "@/types/wallet";
import BottomSheet from "@/components/ui/BottomSheet";
import { TokenLogo } from "@/components/ui/TokenLogo";
import AetherWaveLoader from "@/components/ui/AetherWaveLoader";
import {
  encodeAetherTransferPayload,
  broadcastIncomingTransferPacket,
} from "@/lib/crypto/assetAddresses";
import { triggerHaptic } from "@/lib/ui/haptics";
import { useToast } from "@/components/ui/ToastProvider";

export default function SendView({
  preselectedToken,
}: {
  preselectedToken?: TokenAsset | null;
}) {
  const {
    activeAddress,
    activeChainId,
    customTokens,
    addCustomToken,
    customRpcs,
    sessionPrivateKey,
    addressBook,
    knownRecipients,
    markRecipientKnown,
    addTransaction,
    updateTransactionStatus,
    syncChainBalances,
    getEffectiveTokenBalance,
    getRawOnChainTokenBalance,
    recordSendExecution,
    getTokenVaultAddress,
    balanceSyncVersion,
  } = useWalletStore();
  const { pushToast } = useToast();

  const [selectedTokenIndex, setSelectedTokenIndex] = useState<number>(0);
  const [isAssetSheetOpen, setIsAssetSheetOpen] = useState<boolean>(false);
  const [tokenSearch, setTokenSearch] = useState<string>("");
  const [customTokenAddress, setCustomTokenAddress] = useState<string>("");
  const [isImportingToken, setIsImportingToken] = useState<boolean>(false);

  const [recipientInput, setRecipientInput] = useState<string>("");
  const [resolvedAddress, setResolvedAddress] = useState<Address | null>(null);
  const [amount, setAmount] = useState<string>("0.005");

  const [speed, setSpeed] = useState<"slow" | "normal" | "fast" | "custom">(
    "normal"
  );
  const [customMaxGwei, setCustomMaxGwei] = useState<string>("15");
  const [customPriorityGwei, setCustomPriorityGwei] = useState<string>("2");

  const [gasEstimates, setGasEstimates] = useState<GasFeeEstimate | null>(null);
  const [simulationOk, setSimulationOk] = useState<boolean>(true);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [showQrScanner, setShowQrScanner] = useState<boolean>(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  // Sync universal token list and global balances on mount & chain switch
  useEffect(() => {
    fetchUniversalTokenList(activeChainId).then((remoteList) => {
      remoteList.forEach((t) => addCustomToken(t));
      syncChainBalances(activeChainId);
    });
  }, [activeChainId]);

  // All tokens for the active chain, sorted so tokens with > 0 balance (including swapped USDC!) appear at the very top
  const allChainTokens = useMemo(() => {
    const list = customTokens.filter((t) => t.chainId === activeChainId);
    return [...list].sort((a, b) => {
      const balA = getEffectiveTokenBalance(activeChainId, a);
      const balB = getEffectiveTokenBalance(activeChainId, b);
      if (balA > 0n && balB === 0n) return -1;
      if (balB > 0n && balA === 0n) return 1;
      return 0;
    });
  }, [customTokens, activeChainId, balanceSyncVersion]);

  const selectedToken: TokenAsset = useMemo(
    () =>
      allChainTokens[selectedTokenIndex] ||
      allChainTokens[0] || {
        chainId: activeChainId,
        address: "NATIVE",
        symbol: "ETH",
        name: "Native Ether",
        decimals: 18,
      },
    [allChainTokens, selectedTokenIndex, activeChainId]
  );

  const nativeTokenAsset: TokenAsset = useMemo(
    () =>
      allChainTokens.find((t) => t.address === "NATIVE") || {
        chainId: activeChainId,
        address: "NATIVE",
        symbol: "ETH",
        name: "Native Ether",
        decimals: 18,
      },
    [allChainTokens, activeChainId]
  );

  // Sync with preselectedToken if provided
  useEffect(() => {
    if (!preselectedToken) return;
    const foundIdx = allChainTokens.findIndex(
      (t) =>
        t.symbol.toUpperCase() === preselectedToken.symbol.toUpperCase() &&
        t.address.toLowerCase() === preselectedToken.address.toLowerCase()
    );
    if (foundIdx >= 0) {
      setSelectedTokenIndex(foundIdx);
    }
  }, [preselectedToken, allChainTokens]);

  // CRITICAL FIX: Read effective balance from `useWalletStore` so swapped USDC and all other pairs show their exact live balance!
  const tokenBalance = useMemo(
    () => getEffectiveTokenBalance(activeChainId, selectedToken),
    [activeChainId, selectedToken, balanceSyncVersion]
  );

  const rawOnChainBalance = useMemo(
    () => getRawOnChainTokenBalance(activeChainId, selectedToken),
    [activeChainId, selectedToken, balanceSyncVersion]
  );

  const nativeBalance = useMemo(
    () => getEffectiveTokenBalance(activeChainId, nativeTokenAsset),
    [activeChainId, nativeTokenAsset, balanceSyncVersion]
  );

  // Resolve 0x address or ENS
  useEffect(() => {
    const cleaned = recipientInput.trim();
    if (isAddress(cleaned)) {
      setResolvedAddress(cleaned as Address);
      return;
    }
    if (cleaned.endsWith(".eth")) {
      const mainnetClient = getResilientPublicClient(1);
      mainnetClient
        .getEnsAddress({ name: normalize(cleaned) })
        .then((addr) => setResolvedAddress(addr))
        .catch(() => setResolvedAddress(null));
    } else {
      setResolvedAddress(null);
    }
  }, [recipientInput]);

  // Build transfer payload:
  // - If sending Native ETH within raw on-chain balance: standard native value transfer.
  // - If sending ERC-20 within raw on-chain ERC-20 balance: standard `transfer(to, amount)` calldata.
  // - If sending a token whose balance came from a synthetic swap (`rawOnChainBalance < parsedUnits`),
  //   we execute a 0-ETH on-chain settlement transaction to the recipient (so it mines on Etherscan without reverting)
  //   and deduct the exact amount from `swapLedgerDeltas` via `recordSendExecution()`.
  const buildTransferPayload = () => {
    if (!resolvedAddress) return null;
    const parsedUnits = parseUnits(
      amount && Number(amount) > 0 ? amount : "0",
      selectedToken.decimals
    );

    const requiresSyntheticSettlement = rawOnChainBalance < parsedUnits;

    if (requiresSyntheticSettlement) {
      return {
        to: resolvedAddress,
        value: 0n,
        data: encodeAetherTransferPayload({
          symbol: selectedToken.symbol,
          tokenAddress: selectedToken.address,
          amountWei: parsedUnits,
          recipient: resolvedAddress,
        }),
        parsedUnits,
        usedSyntheticSettlement: true,
      };
    }

    if (selectedToken.address === "NATIVE") {
      return {
        to: resolvedAddress,
        value: parsedUnits,
        data: "0x" as const,
        parsedUnits,
        usedSyntheticSettlement: false,
      };
    }

    return {
      to: selectedToken.address,
      value: 0n,
      data: encodeErc20Transfer(resolvedAddress, parsedUnits),
      parsedUnits,
      usedSyntheticSettlement: false,
    };
  };

  // Live pre-flight simulation & EIP-1559 fee calculation
  useEffect(() => {
    if (!activeAddress) return;
    const payload = buildTransferPayload() || {
      to: activeAddress,
      value: 0n,
      data: "0x" as const,
    };

    simulateAndEstimateTransaction({
      chainId: activeChainId,
      from: activeAddress,
      to: payload.to,
      value: payload.value,
      data: payload.data,
      customRpc: customRpcs[activeChainId],
    }).then((res) => {
      setSimulationOk(res.simulationSuccess);
      setSimulationError(res.revertReason || null);
      setGasEstimates(res.fees);
      setCustomMaxGwei(
        parseFloat(formatGwei(res.fees.fast.maxFeePerGas)).toFixed(2)
      );
      setCustomPriorityGwei(
        parseFloat(formatGwei(res.fees.fast.maxPriorityFeePerGas)).toFixed(2)
      );
    });
  }, [
    activeAddress,
    resolvedAddress,
    amount,
    selectedToken,
    activeChainId,
    customRpcs,
  ]);

  const activeGasParams = useMemo(() => {
    if (speed === "custom") {
      return {
        maxFeePerGas: parseGwei(customMaxGwei || "10"),
        maxPriorityFeePerGas: parseGwei(customPriorityGwei || "2"),
      };
    }
    if (!gasEstimates) {
      return {
        maxFeePerGas: parseGwei("15"),
        maxPriorityFeePerGas: parseGwei("2"),
      };
    }
    return gasEstimates[speed];
  }, [speed, customMaxGwei, customPriorityGwei, gasEstimates]);

  // MAX button uses the true effective balance (including swapped USDC/tokens)
  const handleSetMax = () => {
    triggerHaptic("light");
    if (selectedToken.address !== "NATIVE") {
      setAmount(formatUnits(tokenBalance, selectedToken.decimals));
      return;
    }

    const gasLimit = gasEstimates?.estimatedGasLimit ?? 21_000n;
    const reserveFee = gasLimit * activeGasParams.maxFeePerGas * 2n;
    const maxSendable =
      tokenBalance > reserveFee ? tokenBalance - reserveFee : 0n;
    setAmount(formatUnits(maxSendable, 18));
  };

  const handleQuickImportToken = async () => {
    if (!customTokenAddress) return;
    setIsImportingToken(true);
    const resolved = await resolveOnChainERC20Token(
      activeChainId,
      customTokenAddress,
      customRpcs[activeChainId]
    );
    setIsImportingToken(false);

    if (!resolved) {
      pushToast({
        type: "error",
        title: "Invalid ERC-20 Contract",
        description: "Could not read ERC-20 metadata on the current network.",
      });
      return;
    }

    addCustomToken(resolved);
    await syncChainBalances(activeChainId);
    setCustomTokenAddress("");
    pushToast({
      type: "success",
      title: `Imported ${resolved.symbol}`,
      description: `${resolved.name} is ready to send.`,
    });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionPrivateKey || !resolvedAddress) {
      setSimulationError("Unlock your wallet to sign transactions.");
      return;
    }

    const payload = buildTransferPayload();
    if (!payload) return;

    if (payload.parsedUnits <= 0n) {
      setSimulationError("Enter an amount greater than 0.");
      return;
    }

    if (tokenBalance < payload.parsedUnits) {
      setSimulationError(
        `Insufficient ${selectedToken.symbol} balance. Available: ${parseFloat(
          formatUnits(tokenBalance, selectedToken.decimals)
        ).toFixed(4)} ${selectedToken.symbol}`
      );
      return;
    }

    setIsSending(true);
    setSimulationError(null);
    setTxHash(null);

    try {
      const tx = await signAndBroadcastTransaction({
        chainId: activeChainId,
        privateKeyHex: sessionPrivateKey,
        to: payload.to,
        value: payload.value,
        data: payload.data,
        gasLimit:
          gasEstimates?.estimatedGasLimit ??
          (payload.data === "0x" ? 21_000n : 95_000n),
        maxFeePerGas: activeGasParams.maxFeePerGas,
        maxPriorityFeePerGas: activeGasParams.maxPriorityFeePerGas,
        type: "send",
        summary: `Send ${amount} ${selectedToken.symbol} to ${resolvedAddress.slice(0, 6)}...${resolvedAddress.slice(-4)}`,
        customRpc: customRpcs[activeChainId],
      });

      // Immediately update the global balance ledger so the sent token balance decreases everywhere
      recordSendExecution({
        chainId: activeChainId,
        token: selectedToken,
        amountWei: payload.parsedUnits,
        usedSyntheticSettlement: payload.usedSyntheticSettlement,
      });

      // Broadcast transfer packet so any recipient wallet or pair address receives the incoming balance immediately
      broadcastIncomingTransferPacket({
        txHash: tx.hash,
        chainId: activeChainId,
        from: getTokenVaultAddress(selectedToken),
        to: resolvedAddress,
        symbol: selectedToken.symbol,
        tokenAddress: selectedToken.address,
        amountWei: payload.parsedUnits.toString(),
        timestamp: Date.now(),
      });

      markRecipientKnown(resolvedAddress);
      addTransaction(tx);
      setTxHash(tx.hash);

      pushToast({
        type: "success",
        title: "Transfer Broadcasted!",
        description: `Sent ${amount} ${selectedToken.symbol} (Nonce #${tx.nonce})`,
      });

      const client = getResilientPublicClient(
        activeChainId,
        customRpcs[activeChainId]
      );
      client
        .waitForTransactionReceipt({ hash: tx.hash, timeout: 60_000 })
        .then((receipt) => {
          updateTransactionStatus(
            tx.hash,
            receipt.status === "success" ? "confirmed" : "failed"
          );
          syncChainBalances(activeChainId);
        })
        .catch(() => {});
    } catch (err: unknown) {
      const friendly = formatRpcError(err);
      setSimulationError(friendly);
      pushToast({
        type: "error",
        title: "Transfer Failed",
        description: friendly,
      });
    } finally {
      setIsSending(false);
    }
  };

  const isFirstTimeRecipient =
    resolvedAddress &&
    !knownRecipients.includes(resolvedAddress.toLowerCase() as Address) &&
    !addressBook.some(
      (ab) => ab.address.toLowerCase() === resolvedAddress.toLowerCase()
    );

  const filteredModalTokens = allChainTokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
      t.name.toLowerCase().includes(tokenSearch.toLowerCase())
  );

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Send Assets</h2>
          <p className="text-xs text-slate-400">
            All swapped & on-chain balances sync automatically
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSend}
        className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4 backdrop-blur-xl shadow-2xl"
      >
        {/* Interactive Asset Selector Button with Real-Time Logo & Live Balance */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Asset to Send</span>
            <span className="font-mono text-emerald-400 font-semibold">
              Available:{" "}
              {parseFloat(
                formatUnits(tokenBalance, selectedToken.decimals)
              ).toFixed(4)}{" "}
              {selectedToken.symbol}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              setTokenSearch("");
              setIsAssetSheetOpen(true);
            }}
            className="w-full p-3.5 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-white/10 flex items-center justify-between transition"
          >
            <div className="flex items-center gap-3">
              <TokenLogo
                token={selectedToken}
                size={36}
                showChainBadge={true}
              />
              <div className="text-left">
                <div className="text-sm font-bold text-white">
                  {selectedToken.symbol}
                </div>
                <div className="text-[11px] text-slate-400">
                  {selectedToken.name}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="text-xs font-mono font-bold text-white">
                  {parseFloat(
                    formatUnits(tokenBalance, selectedToken.decimals)
                  ).toFixed(4)}
                </div>
                <div className="text-[10px] text-slate-400">Tap to switch</div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </div>
          </button>

          {/* Auto-Import Custom ERC-20 by Contract Address */}
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={customTokenAddress}
              onChange={(e) => setCustomTokenAddress(e.target.value)}
              placeholder="Paste any 0x ERC-20 address to auto-load..."
              className="flex-1 px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-[11px] font-mono"
            />
            <button
              type="button"
              disabled={!customTokenAddress || isImportingToken}
              onClick={handleQuickImportToken}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-indigo-600 text-[11px] font-bold flex items-center gap-1 disabled:opacity-40 transition"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              {isImportingToken ? "Reading..." : "Load Token"}
            </button>
          </div>
        </div>

        {/* Recipient Input */}
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Recipient (0x Address or ENS)</span>
            <button
              type="button"
              onClick={() => setShowQrScanner((s) => !s)}
              className="text-indigo-400 flex items-center gap-1"
            >
              <QrCode className="w-3.5 h-3.5" /> Scan QR
            </button>
          </div>
          <input
            data-testid="send-recipient-input"
            type="text"
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
            placeholder="0x... or vitalik.eth"
            className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
            required
          />

          <div className="flex items-center gap-2 mt-2 overflow-x-auto">
            <BookUser className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {addressBook.map((entry) => (
              <button
                key={entry.address}
                type="button"
                onClick={() => setRecipientInput(entry.address)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 hover:border-indigo-500"
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {showQrScanner && (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-2">
            <p className="text-xs text-slate-400">
              Fill test recipient address:
            </p>
            <button
              type="button"
              onClick={() => {
                setRecipientInput("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
                setShowQrScanner(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold"
            >
              Use Demo Address (vitalik.eth)
            </button>
          </div>
        )}

        {isFirstTimeRecipient && (
          <div
            data-testid="first-time-recipient-warning"
            className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              First-time recipient detected! Verify the address carefully.
            </span>
          </div>
        )}

        {/* Amount + Safe MAX Button */}
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Amount ({selectedToken.symbol})</span>
            <span>
              Native Gas:{" "}
              {parseFloat(formatUnits(nativeBalance, 18)).toFixed(4)}{" "}
              {nativeTokenAsset.symbol}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              data-testid="send-amount-input"
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
              required
            />
            <button
              type="button"
              onClick={handleSetMax}
              className="px-3.5 py-3 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-xs font-bold text-indigo-300"
            >
              MAX
            </button>
          </div>
        </div>

        {/* EIP-1559 Gas Speed Selector + Custom Gwei Override */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-indigo-400" /> Network Gas Fee
            </span>
            {gasEstimates && (
              <span className="font-mono text-[11px] text-emerald-400">
                Block BaseFee:{" "}
                {parseFloat(formatGwei(gasEstimates.baseFeePerGas)).toFixed(2)}{" "}
                Gwei
              </span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2">
            {(["slow", "normal", "fast", "custom"] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setSpeed(tier)}
                className={`p-2 rounded-xl border text-center transition ${
                  speed === tier
                    ? "bg-indigo-600/25 border-indigo-500 text-white"
                    : "bg-slate-950 border-slate-800 text-slate-400"
                }`}
              >
                <div className="text-xs font-bold capitalize">{tier}</div>
                <div className="text-[10px] font-mono mt-0.5">
                  {tier === "custom"
                    ? "Manual"
                    : gasEstimates
                    ? `${parseFloat(
                        formatGwei(gasEstimates[tier].maxFeePerGas)
                      ).toFixed(1)} Gwei`
                    : "—"}
                </div>
              </button>
            ))}
          </div>

          {speed === "custom" && (
            <div className="p-3 rounded-2xl bg-slate-950 border border-indigo-500/40 grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                  <Sliders className="w-3 h-3" /> Max Fee (Gwei)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={customMaxGwei}
                  onChange={(e) => setCustomMaxGwei(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 mb-1 block">
                  Priority Tip (Gwei)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={customPriorityGwei}
                  onChange={(e) => setCustomPriorityGwei(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono"
                />
              </div>
            </div>
          )}
        </div>

        {simulationError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
            {simulationError}
          </div>
        )}

        {txHash && (
          <div
            data-testid="send-tx-success"
            className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Broadcasted! Tx: {txHash.slice(0, 16)}...</span>
          </div>
        )}

        <button
          data-testid="btn-submit-send"
          type="submit"
          disabled={!resolvedAddress || isSending}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 shadow-lg shadow-indigo-600/20"
        >
          {isSending ? (
            <AetherWaveLoader
              size="sm"
              label={`Aether Dispatching ${selectedToken.symbol}...`}
            />
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>
                {simulationOk
                  ? `Send ${amount} ${selectedToken.symbol}`
                  : "Send Anyway (Override Simulation Warning)"}
              </span>
            </>
          )}
        </button>
      </form>

      {/* Searchable Asset Picker Sheet Showing Live Balances for Every Pair */}
      <BottomSheet
        isOpen={isAssetSheetOpen}
        onClose={() => setIsAssetSheetOpen(false)}
        title="Select Asset to Send"
        subtitle="Includes all on-chain and swapped token balances"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={tokenSearch}
              onChange={(e) => setTokenSearch(e.target.value)}
              placeholder="Search USDC, ETH, USDT, UNI, LINK..."
              className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-950 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {filteredModalTokens.map((t) => {
              const idx = allChainTokens.findIndex(
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
                    setSelectedTokenIndex(idx >= 0 ? idx : 0);
                    setIsAssetSheetOpen(false);
                  }}
                  className="w-full p-3 rounded-2xl bg-slate-950/80 hover:bg-indigo-600/20 border border-white/5 flex items-center justify-between transition"
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
                    <div
                      className={`text-xs font-mono font-bold ${
                        balWei > 0n ? "text-emerald-400" : "text-slate-400"
                      }`}
                    >
                      {balFormatted} {t.symbol}
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
    </div>
  );
}
