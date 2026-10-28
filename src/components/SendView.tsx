"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  AlertTriangle,
  BookUser,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
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
import {
  CHAIN_METADATA,
  getResilientPublicClient,
} from "@/lib/chains/config";
import {
  encodeErc20Transfer,
  GasFeeEstimate,
  simulateAndEstimateTransaction,
  signAndBroadcastTransaction,
  formatRpcError,
} from "@/lib/tx/engine";
import { broadcastIncomingTransferPacket } from "@/lib/crypto/assetAddresses";
import { resolveOnChainERC20Token } from "@/lib/tokens/registry";
import { TokenAsset } from "@/types/wallet";
import BottomSheet from "@/components/ui/BottomSheet";
import { TokenLogo } from "@/components/ui/TokenLogo";
import AetherWaveLoader from "@/components/ui/AetherWaveLoader";
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
    processInstantInboxAndBlockPayloads,
    getEffectiveTokenBalance,
    getRawOnChainTokenBalance,
    getTokenVaultAddress,
    commitConfirmedSend,
    balanceSyncVersion,
  } = useWalletStore();
  const { pushToast } = useToast();

  // Force a fresh on-chain balance sync when opening the Send tab
  useEffect(() => {
    syncChainBalances(activeChainId, true);
  }, [activeChainId]);

  const isTestnet = CHAIN_METADATA[activeChainId].isTestnet;

  const allChainTokens = useMemo(() => {
    const list = customTokens.filter((t) => t.chainId === activeChainId);
    return [...list].sort((a, b) => {
      const balA = isTestnet
        ? getEffectiveTokenBalance(activeChainId, a)
        : getRawOnChainTokenBalance(activeChainId, a);
      const balB = isTestnet
        ? getEffectiveTokenBalance(activeChainId, b)
        : getRawOnChainTokenBalance(activeChainId, b);
      if (balA > 0n && balB === 0n) return -1;
      if (balB > 0n && balA === 0n) return 1;
      return 0;
    });
  }, [customTokens, activeChainId, balanceSyncVersion, isTestnet]);

  const [selectedTokenIndex, setSelectedTokenIndex] = useState<number>(0);

  useEffect(() => {
    if (!preselectedToken) return;
    const idx = allChainTokens.findIndex(
      (t) =>
        t.symbol.toUpperCase() === preselectedToken.symbol.toUpperCase() &&
        t.address.toLowerCase() === preselectedToken.address.toLowerCase()
    );
    if (idx >= 0) setSelectedTokenIndex(idx);
  }, [preselectedToken, allChainTokens.length]);

  const [isAssetSheetOpen, setIsAssetSheetOpen] = useState<boolean>(false);
  const [tokenSearch, setTokenSearch] = useState<string>("");
  const [customTokenAddress, setCustomTokenAddress] = useState<string>("");
  const [isImportingToken, setIsImportingToken] = useState<boolean>(false);

  const [recipientInput, setRecipientInput] = useState<string>("");
  const [resolvedAddress, setResolvedAddress] = useState<Address | null>(null);
  const [amount, setAmount] = useState<string>("0.0001");

  const [speed, setSpeed] = useState<"slow" | "normal" | "fast" | "custom">(
    "normal"
  );
  const [customMaxGwei, setCustomMaxGwei] = useState<string>("1");
  const [customPriorityGwei, setCustomPriorityGwei] = useState<string>("1");

  const [gasEstimates, setGasEstimates] = useState<GasFeeEstimate | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [showQrScanner, setShowQrScanner] = useState<boolean>(false);
  const [txResult, setTxResult] = useState<{
    hash: string;
    explorerUrl: string;
  } | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

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

  // On Mainnet, strictly use true on-chain balance (`getRawOnChainTokenBalance`) so you never try to send unbacked synthetic tokens!
  const rawOnChainBalance = useMemo(
    () => getRawOnChainTokenBalance(activeChainId, selectedToken),
    [activeChainId, selectedToken, balanceSyncVersion]
  );

  const tokenBalance = useMemo(
    () =>
      isTestnet
        ? getEffectiveTokenBalance(activeChainId, selectedToken)
        : rawOnChainBalance,
    [
      isTestnet,
      activeChainId,
      selectedToken,
      rawOnChainBalance,
      balanceSyncVersion,
    ]
  );

  const nativeBalance = useMemo(
    () => getRawOnChainTokenBalance(activeChainId, nativeTokenAsset),
    [activeChainId, nativeTokenAsset, balanceSyncVersion]
  );

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

  const buildTransferPayload = () => {
    if (!resolvedAddress) return null;
    let parsedUnits = 0n;
    try {
      parsedUnits = parseUnits(
        amount && Number(amount) > 0 ? amount : "0",
        selectedToken.decimals
      );
    } catch {
      parsedUnits = 0n;
    }

    // Only use synthetic settlement on Sepolia Testnet when testing faucet/swapped tokens
    const useTestnetSynthetic = isTestnet && rawOnChainBalance < parsedUnits;

    if (useTestnetSynthetic) {
      return {
        to: resolvedAddress,
        value: 0n,
        data: "0x" as const,
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

  useEffect(() => {
    if (!activeAddress) return;
    const timer = setTimeout(() => {
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
        setGasEstimates(res.fees);
        setCustomMaxGwei(
          parseFloat(formatGwei(res.fees.normal.maxFeePerGas)).toFixed(2)
        );
        setCustomPriorityGwei(
          parseFloat(formatGwei(res.fees.normal.maxPriorityFeePerGas)).toFixed(
            2
          )
        );
      });
    }, 300);

    return () => clearTimeout(timer);
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
        maxFeePerGas: parseGwei(customMaxGwei || "1"),
        maxPriorityFeePerGas: parseGwei(customPriorityGwei || "1"),
      };
    }
    if (!gasEstimates) {
      return {
        maxFeePerGas: parseGwei("1"),
        maxPriorityFeePerGas: parseGwei("1"),
      };
    }
    return gasEstimates[speed];
  }, [speed, customMaxGwei, customPriorityGwei, gasEstimates]);

  // Use dynamic estimatedGasLimit (65,000 for contract recipients, 21,000 for EOA wallets)
  const handleSetMax = () => {
    triggerHaptic("light");
    if (selectedToken.address !== "NATIVE") {
      setAmount(formatUnits(tokenBalance, selectedToken.decimals));
      return;
    }

    // Use dynamic estimatedGasLimit (65,000 for contract recipients, 21,000 for EOA wallets)
    const gasLimit = gasEstimates?.estimatedGasLimit ?? 65_000n;
    const reserveFee = gasLimit * activeGasParams.maxFeePerGas;
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
    await syncChainBalances(activeChainId, true);
    setCustomTokenAddress("");
    pushToast({
      type: "success",
      title: `Imported ${resolved.symbol}`,
      description: `${resolved.name} is ready to send.`,
    });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionPrivateKey || !resolvedAddress || !activeAddress) {
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
        `Insufficient on-chain ${selectedToken.symbol} balance. You have ${parseFloat(
          formatUnits(tokenBalance, selectedToken.decimals)
        ).toFixed(6)} ${selectedToken.symbol} available.`
      );
      return;
    }

    setIsSending(true);
    setSimulationError(null);
    setTxResult(null);

    try {
      const senderPairAddress = getTokenVaultAddress(selectedToken);

      // 1. Broadcast REAL signed transaction to the blockchain mempool
      const tx = await signAndBroadcastTransaction({
        chainId: activeChainId,
        privateKeyHex: sessionPrivateKey,
        to: payload.to,
        value: payload.value,
        data: payload.data,
        gasLimit: gasEstimates?.estimatedGasLimit ?? 65_000n,
        maxFeePerGas: activeGasParams.maxFeePerGas,
        maxPriorityFeePerGas: activeGasParams.maxPriorityFeePerGas,
        type: "send",
        summary: `Send ${amount} ${selectedToken.symbol} to ${resolvedAddress.slice(0, 6)}...${resolvedAddress.slice(-4)}`,
        customRpc: customRpcs[activeChainId],
      });

      markRecipientKnown(resolvedAddress);
      addTransaction(tx);
      setTxResult({ hash: tx.hash, explorerUrl: tx.explorerUrl });

      pushToast({
        type: "info",
        title: "Broadcasted to Blockchain!",
        description: `Waiting for block confirmation (${tx.hash.slice(0, 10)}...)`,
      });

      // 2. Wait for the REAL on-chain receipt from BscScan / Etherscan RPC nodes
      const client = getResilientPublicClient(
        activeChainId,
        customRpcs[activeChainId]
      );

      const receipt = await client.waitForTransactionReceipt({
        hash: tx.hash,
        timeout: 45_000,
      });

      if (receipt.status === "success") {
        commitConfirmedSend({
          txHash: tx.hash,
          chainId: activeChainId,
          token: selectedToken,
          amountWei: payload.parsedUnits,
          usedSyntheticSettlement: payload.usedSyntheticSettlement,
        });

        broadcastIncomingTransferPacket({
          txHash: tx.hash,
          chainId: activeChainId,
          from: senderPairAddress,
          to: resolvedAddress,
          symbol: selectedToken.symbol,
          tokenAddress: selectedToken.address,
          amountWei: payload.parsedUnits.toString(),
          timestamp: Date.now(),
        });

        await syncChainBalances(activeChainId, true);
        triggerHaptic("success");
        pushToast({
          type: "success",
          title: `${selectedToken.symbol} Confirmed On-Chain!`,
          description: `Block #${receipt.blockNumber.toString()} • Delivered to ${resolvedAddress.slice(0, 6)}...${resolvedAddress.slice(-4)}`,
        });
      } else {
        updateTransactionStatus(tx.hash, "failed");
        setSimulationError(
          "Transaction reverted on-chain. Check BscScan/Etherscan link below."
        );
      }
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
        <h2 className="text-xl font-bold">Send {selectedToken.symbol}</h2>
      </div>

      <form
        onSubmit={handleSend}
        className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4 backdrop-blur-xl shadow-2xl"
      >
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Asset (On-Chain Balance)</span>
            <span className="font-mono text-emerald-400 font-semibold">
              Available:{" "}
              {parseFloat(
                formatUnits(tokenBalance, selectedToken.decimals)
              ).toFixed(6)}{" "}
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
                  ).toFixed(6)}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </div>
          </button>

          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={customTokenAddress}
              onChange={(e) => setCustomTokenAddress(e.target.value)}
              placeholder="Paste 0x contract address to load..."
              className="flex-1 px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-[11px] font-mono"
            />
            <button
              type="button"
              disabled={!customTokenAddress || isImportingToken}
              onClick={handleQuickImportToken}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-indigo-600 text-[11px] font-bold flex items-center gap-1 disabled:opacity-40 transition"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              {isImportingToken ? "..." : "Load"}
            </button>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Recipient Address</span>
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
            <button
              type="button"
              onClick={() => {
                setRecipientInput(getTokenVaultAddress(selectedToken));
                setShowQrScanner(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold"
            >
              Paste My {selectedToken.symbol} Address
            </button>
          </div>
        )}

        {isFirstTimeRecipient && (
          <div
            data-testid="first-time-recipient-warning"
            className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>First-time recipient address.</span>
          </div>
        )}

        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Amount ({selectedToken.symbol})</span>
            <span>
              On-Chain Gas:{" "}
              {parseFloat(formatUnits(nativeBalance, 18)).toFixed(6)}{" "}
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

        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-indigo-400" /> Gas Speed
            </span>
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

        {txResult && (
          <div
            data-testid="send-tx-success"
            className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>On-Chain Tx: {txResult.hash.slice(0, 14)}...</span>
            </div>
            <a
              href={txResult.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 hover:underline flex items-center gap-1 font-bold"
            >
              <span>View Explorer</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        <button
          data-testid="btn-submit-send"
          type="submit"
          disabled={!resolvedAddress || isSending}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 shadow-lg shadow-indigo-600/20"
        >
          {isSending ? (
            <AetherWaveLoader
              size="sm"
              label={`Broadcasting ${selectedToken.symbol} On-Chain...`}
            />
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>Send {amount} {selectedToken.symbol}</span>
            </>
          )}
        </button>
      </form>

      <BottomSheet
        isOpen={isAssetSheetOpen}
        onClose={() => setIsAssetSheetOpen(false)}
        title="Select Asset"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={tokenSearch}
              onChange={(e) => setTokenSearch(e.target.value)}
              placeholder="Search USDC, ETH, USDT, BTC, SOL, QIE..."
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
              const balWei = isTestnet
                ? getEffectiveTokenBalance(activeChainId, t)
                : getRawOnChainTokenBalance(activeChainId, t);
              const balFormatted = parseFloat(
                formatUnits(balWei, t.decimals)
              ).toFixed(6);

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