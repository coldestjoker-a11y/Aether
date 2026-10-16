"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  AlertTriangle,
  BookUser,
  CheckCircle2,
  Gauge,
  QrCode,
  Send,
  Sliders,
  PlusCircle,
} from "lucide-react";
import {
  Address,
  formatGwei,
  formatUnits,
  isAddress,
  parseAbi,
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
import { triggerHaptic } from "@/lib/ui/haptics";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { useToast } from "@/components/ui/ToastProvider";

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export default function SendView() {
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
  } = useWalletStore();
  const { pushToast } = useToast();

  const [allChainTokens, setAllChainTokens] = useState<TokenAsset[]>([]);
  const [selectedTokenIndex, setSelectedTokenIndex] = useState<number>(0);
  const [customTokenAddress, setCustomTokenAddress] = useState<string>("");
  const [isImportingToken, setIsImportingToken] = useState<boolean>(false);

  const [recipientInput, setRecipientInput] = useState<string>("");
  const [resolvedAddress, setResolvedAddress] = useState<Address | null>(null);
  const [amount, setAmount] = useState<string>("0.005");
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [nativeBalance, setNativeBalance] = useState<bigint>(0n);

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

  // Load universal token catalog for active chain
  useEffect(() => {
    let mounted = true;
    fetchUniversalTokenList(activeChainId).then((remoteList) => {
      if (!mounted) return;
      const userCustom = customTokens.filter((t) => t.chainId === activeChainId);
      const mergedMap = new Map<string, TokenAsset>();
      [...userCustom, ...remoteList].forEach((t) => {
        mergedMap.set(t.address.toLowerCase(), t);
      });
      setAllChainTokens(Array.from(mergedMap.values()));
      setSelectedTokenIndex(0);
    });
    return () => {
      mounted = false;
    };
  }, [activeChainId, customTokens]);

  const selectedToken: TokenAsset = useMemo(
    () =>
      allChainTokens[selectedTokenIndex] || {
        chainId: activeChainId,
        address: "NATIVE",
        symbol: "ETH",
        name: "Native Ether",
        decimals: 18,
      },
    [allChainTokens, selectedTokenIndex, activeChainId]
  );

  // Fetch both selected token balance and native gas balance
  useEffect(() => {
    if (!activeAddress) return;
    const client = getResilientPublicClient(
      activeChainId,
      customRpcs[activeChainId]
    );

    client
      .getBalance({ address: activeAddress })
      .then((nat) => {
        setNativeBalance(nat);
        if (selectedToken.address === "NATIVE") {
          setTokenBalance(nat);
        }
      })
      .catch(() => {});

    if (selectedToken.address !== "NATIVE") {
      client
        .readContract({
          address: selectedToken.address,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [activeAddress],
        })
        .then(setTokenBalance)
        .catch(() => setTokenBalance(0n));
    }
  }, [activeAddress, activeChainId, selectedToken, customRpcs]);

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

  // Build transaction target/value/data for Native vs ERC-20 transfer
  const buildTransferPayload = () => {
    if (!resolvedAddress) return null;
    const parsedUnits = parseUnits(
      amount && Number(amount) > 0 ? amount : "0",
      selectedToken.decimals
    );

    if (selectedToken.address === "NATIVE") {
      return {
        to: resolvedAddress,
        value: parsedUnits,
        data: "0x" as const,
      };
    }

    return {
      to: selectedToken.address,
      value: 0n,
      data: encodeErc20Transfer(resolvedAddress, parsedUnits),
    };
  };

  // Run live simulation & EIP-1559 fee calculation
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

  // Safe MAX button calculation: reserves 2x gas cost when sending Native ETH so it never fails
  const handleSetMax = () => {
    triggerHaptic("light");
    if (selectedToken.address !== "NATIVE") {
      setAmount(formatUnits(tokenBalance, selectedToken.decimals));
      return;
    }

    const gasLimit = gasEstimates?.estimatedGasLimit ?? 21_000n;
    const reserveFee = gasLimit * activeGasParams.maxFeePerGas * 2n;
    const maxSendable =
      nativeBalance > reserveFee ? nativeBalance - reserveFee : 0n;
    setAmount(formatUnits(maxSendable, 18));
  };

  // On-chain Custom Token Importer inside Send View
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
    setAllChainTokens((prev) => [resolved, ...prev]);
    setSelectedTokenIndex(0);
    setCustomTokenAddress("");
    pushToast({
      type: "success",
      title: `Imported ${resolved.symbol}`,
      description: `${resolved.name} (${resolved.decimals} decimals) is ready to send.`,
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
          (selectedToken.address === "NATIVE" ? 21_000n : 95_000n),
        maxFeePerGas: activeGasParams.maxFeePerGas,
        maxPriorityFeePerGas: activeGasParams.maxPriorityFeePerGas,
        type: "send",
        summary: `Send ${amount} ${selectedToken.symbol} to ${resolvedAddress.slice(0, 6)}...${resolvedAddress.slice(-4)}`,
        customRpc: customRpcs[activeChainId],
      });

      markRecipientKnown(resolvedAddress);
      addTransaction(tx);
      setTxHash(tx.hash);
      pushToast({
        type: "success",
        title: "Transfer Broadcasted!",
        description: `${amount} ${selectedToken.symbol} sent with Nonce #${tx.nonce}`,
      });
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

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Send Any Asset</h2>
          <p className="text-xs text-slate-400">
            Auto-buffered EIP-1559 gas prevents stuck or underpriced transfers
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSend}
        className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4 backdrop-blur-xl shadow-2xl"
      >
        {/* Asset Selector + Direct On-Chain Contract Importer */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <TokenLogo token={selectedToken} size={22} showChainBadge={false} />
              <span>Select Asset ({allChainTokens.length} available)</span>
            </div>
            <span>
              Balance:{" "}
              {parseFloat(
                formatUnits(tokenBalance, selectedToken.decimals)
              ).toFixed(4)}{" "}
              {selectedToken.symbol}
            </span>
          </div>

          <select
            value={selectedTokenIndex}
            onChange={(e) => setSelectedTokenIndex(Number(e.target.value))}
            className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
          >
            {allChainTokens.map((t, idx) => (
              <option key={`${t.chainId}-${t.address}`} value={idx}>
                {t.symbol} — {t.name}{" "}
                {t.address === "NATIVE"
                  ? "(Native)"
                  : `(${t.address.slice(0, 6)}...${t.address.slice(-4)})`}
              </option>
            ))}
          </select>

          {/* Auto-Import Any Custom ERC-20 by Contract Address */}
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={customTokenAddress}
              onChange={(e) => setCustomTokenAddress(e.target.value)}
              placeholder="Or paste any 0x ERC-20 token address to auto-load..."
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
              Native Gas Available:{" "}
              {parseFloat(formatUnits(nativeBalance, 18)).toFixed(4)}
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
          <Send className="w-4 h-4" />
          {isSending
            ? "Signing & Broadcasting..."
            : simulationOk
            ? `Send ${amount} ${selectedToken.symbol}`
            : "Send Anyway (Override Simulation Warning)"}
        </button>
      </form>
    </div>
  );
}
