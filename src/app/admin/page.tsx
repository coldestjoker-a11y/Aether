"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
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
  Lock,
  KeyRound,
  ArrowLeft,
  Terminal,
  Server,
} from "lucide-react";
import {
  Address,
  formatEther,
  formatGwei,
  Hex,
  isAddress,
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
import { decryptKeystoreSecret } from "@/lib/crypto/keystore";
import {
  deriveAccountFromMnemonic,
  deriveAccountFromPrivateKey,
} from "@/lib/crypto/hdwallet";
import { SupportedChainId, WalletTransaction } from "@/types/wallet";
import BottomSheet from "@/components/ui/BottomSheet";
import { useToast } from "@/components/ui/ToastProvider";
import { triggerHaptic } from "@/lib/ui/haptics";
import {
  authenticateAdminServerAction,
  verifyAdminSessionServerAction,
  logoutAdminServerAction,
} from "@/app/actions/adminAuth";

const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

export default function StandaloneAdminPortalPage() {
  const {
    keystore,
    activeAddress,
    activeChainId,
    setActiveChainId,
    customRpcs,
    sessionPrivateKey,
    unlockWithSessionKey,
    transactions,
    addTransaction,
    updateTransactionStatus,
  } = useWalletStore();
  const { pushToast } = useToast();

  // Standalone Admin Gate State
  const [isAdminAuthenticated, setIsAdminAuthenticated] =
    useState<boolean>(false);
  const [passcodeInput, setPasscodeInput] = useState<string>("");
  const [vaultPasswordInput, setVaultPasswordInput] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);

  // Monitored Address (Defaults to active wallet address, or any arbitrary 0x address)
  const [monitoredAddressInput, setMonitoredAddressInput] = useState<string>(
    activeAddress || ""
  );
  const [targetAddress, setTargetAddress] = useState<Address | null>(
    activeAddress
  );

  // Telemetry & Filters
  const [directionFilter, setDirectionFilter] = useState<
    "ALL" | "IN" | "OUT" | "FAILED_OR_STUCK"
  >("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isScanningChain, setIsScanningChain] = useState<boolean>(false);
  const [onChainNonce, setOnChainNonce] = useState<number>(0);
  const [pendingNonce, setPendingNonce] = useState<number>(0);
  const [nativeBalanceWei, setNativeBalanceWei] = useState<bigint>(0n);
  const [latestBlockNumber, setLatestBlockNumber] = useState<bigint>(0n);
  const [currentBaseFeeGwei, setCurrentBaseFeeGwei] = useState<string>("0.00");

  // Repair Modal State for Failed / Stuck Transactions
  const [editingTx, setEditingTx] = useState<WalletTransaction | null>(null);
  const [repairTo, setRepairTo] = useState<string>("");
  const [repairValueEth, setRepairValueEth] = useState<string>("0");
  const [repairData, setRepairData] = useState<string>("0x");
  const [repairGasLimit, setRepairGasLimit] = useState<string>("120000");
  const [repairMaxGwei, setRepairMaxGwei] = useState<string>("25");
  const [repairPriorityGwei, setRepairPriorityGwei] = useState<string>("3");
  const [isRepairing, setIsRepairing] = useState<boolean>(false);

  useEffect(() => {
    if (activeAddress && !targetAddress) {
      setTargetAddress(activeAddress);
      setMonitoredAddressInput(activeAddress);
    }
  }, [activeAddress, targetAddress]);

  useEffect(() => {
    verifyAdminSessionServerAction().then((valid) => {
      if (valid) setIsAdminAuthenticated(true);
    });
  }, []);

  // Handle Admin Portal Login + Optional Keystore Unlock for Signing Repairs
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const trimmed = passcodeInput.trim();
    const authRes = await authenticateAdminServerAction(trimmed);
    if (!authRes.success) {
      setAuthError(authRes.error || "Invalid Administrator Authorization Key.");
      return;
    }

    if (keystore && !sessionPrivateKey && vaultPasswordInput) {
      try {
        const secret = await decryptKeystoreSecret(
          keystore,
          vaultPasswordInput
        );
        const { privateKeyHex } =
          keystore.sourceType === "mnemonic"
            ? deriveAccountFromMnemonic(secret)
            : deriveAccountFromPrivateKey(secret);
        unlockWithSessionKey(privateKeyHex);
      } catch {
        setAuthError(
          "Admin passcode valid, but Vault Password was incorrect for signing."
        );
        return;
      }
    }

    setIsAdminAuthenticated(true);
    setPasscodeInput("");
    setVaultPasswordInput("");
  };

  // Unlock Signing Session Directly inside Admin Header if Vault is Locked
  const handleUnlockSignerInAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keystore || !vaultPasswordInput) return;
    try {
      const secret = await decryptKeystoreSecret(keystore, vaultPasswordInput);
      const { privateKeyHex } =
        keystore.sourceType === "mnemonic"
          ? deriveAccountFromMnemonic(secret)
          : deriveAccountFromPrivateKey(secret);
      unlockWithSessionKey(privateKeyHex);
      setVaultPasswordInput("");
      pushToast({
        type: "success",
        title: "Admin Signer Unlocked",
        description: "You can now sign 1-click transaction repairs and nonce overrides.",
      });
    } catch {
      pushToast({
        type: "error",
        title: "Invalid Vault Password",
        description: "Could not decrypt local keystore.",
      });
    }
  };

  // Scan Live Blockchain for IN/OUT Transfers, Receipts & Nonce State
  const syncMempoolAndIncomingLogs = async () => {
    const addrToScan =
      isAddress(monitoredAddressInput.trim())
        ? (monitoredAddressInput.trim() as Address)
        : targetAddress;

    if (!addrToScan) return;
    setTargetAddress(addrToScan);
    setIsScanningChain(true);

    try {
      const client = getResilientPublicClient(
        activeChainId,
        customRpcs[activeChainId]
      );

      const [latestCount, pendingCount, block, natBal] = await Promise.all([
        client.getTransactionCount({
          address: addrToScan,
          blockTag: "latest",
        }),
        client.getTransactionCount({
          address: addrToScan,
          blockTag: "pending",
        }),
        client.getBlock({ blockTag: "latest" }),
        client.getBalance({ address: addrToScan }),
      ]);

      setOnChainNonce(latestCount);
      setPendingNonce(pendingCount);
      setNativeBalanceWei(natBal);
      setLatestBlockNumber(block.number);
      setCurrentBaseFeeGwei(
        block.baseFeePerGas
          ? parseFloat(formatGwei(block.baseFeePerGas)).toFixed(2)
          : "1.50"
      );

      // Re-verify all stored transactions for this chain
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
              // Still pending in mempool or dropped
            }
          })
      );

      // Scan last 600 blocks for both INCOMING and OUTGOING ERC-20 Transfer logs
      const fromBlock = block.number > 600n ? block.number - 600n : 0n;
      const [incomingLogs, outgoingLogs] = await Promise.all([
        client
          .getLogs({
            event: ERC20_TRANSFER_EVENT,
            args: { to: addrToScan },
            fromBlock,
            toBlock: block.number,
          })
          .catch(() => []),
        client
          .getLogs({
            event: ERC20_TRANSFER_EVENT,
            args: { from: addrToScan },
            fromBlock,
            toBlock: block.number,
          })
          .catch(() => []),
      ]);

      const explorerBase =
        SUPPORTED_CHAINS[activeChainId].blockExplorers?.default.url ||
        "https://sepolia.etherscan.io";

      incomingLogs.forEach((log) => {
        if (!log.transactionHash) return;
        const exists = transactions.some(
          (t) => t.hash.toLowerCase() === log.transactionHash!.toLowerCase()
        );
        if (!exists) {
          addTransaction({
            hash: log.transactionHash,
            chainId: activeChainId,
            from: (log.args.from ||
              "0x0000000000000000000000000000000000000000") as Address,
            to: addrToScan,
            value: (log.args.value || 0n).toString(),
            data: "0x",
            nonce: 0,
            maxFeePerGas: "0",
            maxPriorityFeePerGas: "0",
            gasLimit: "65000",
            type: "send",
            summary: `[INCOMING] Token Deposit from ${log.args.from?.slice(0, 6)}...`,
            status: "confirmed",
            timestamp: Date.now(),
            explorerUrl: `${explorerBase}/tx/${log.transactionHash}`,
          });
        }
      });

      outgoingLogs.forEach((log) => {
        if (!log.transactionHash) return;
        const exists = transactions.some(
          (t) => t.hash.toLowerCase() === log.transactionHash!.toLowerCase()
        );
        if (!exists) {
          addTransaction({
            hash: log.transactionHash,
            chainId: activeChainId,
            from: addrToScan,
            to: (log.args.to ||
              "0x0000000000000000000000000000000000000000") as Address,
            value: (log.args.value || 0n).toString(),
            data: "0x",
            nonce: latestCount,
            maxFeePerGas: "0",
            maxPriorityFeePerGas: "0",
            gasLimit: "65000",
            type: "send",
            summary: `[OUTGOING] Token Transfer to ${log.args.to?.slice(0, 6)}...`,
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
    if (isAdminAuthenticated) {
      syncMempoolAndIncomingLogs();
    }
  }, [isAdminAuthenticated, activeChainId, targetAddress]);

  const enrichedTransactions = useMemo(() => {
    const compareAddr = (targetAddress || activeAddress || "").toLowerCase();
    return transactions.map((tx) => {
      const isIncoming =
        tx.summary.includes("[INCOMING]") ||
        (compareAddr &&
          tx.to.toLowerCase() === compareAddr &&
          tx.from.toLowerCase() !== compareAddr);
      return {
        ...tx,
        direction: isIncoming ? ("IN" as const) : ("OUT" as const),
      };
    });
  }, [transactions, targetAddress, activeAddress]);

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
        title: "Signer Locked",
        description:
          "Enter your Vault Password in the top-right bar to sign repair transactions.",
      });
      return;
    }

    triggerHaptic("medium");
    setIsRepairing(true);
    try {
      const boostedGasLimit = (BigInt(tx.gasLimit || "65000") * 150n) / 100n;
      const oldMaxFee = BigInt(tx.maxFeePerGas || parseGwei("15").toString());
      const oldPriority = BigInt(
        tx.maxPriorityFeePerGas || parseGwei("2").toString()
      );

      const boostedMaxFee = (oldMaxFee * 140n) / 100n;
      const boostedPriority = (oldPriority * 140n) / 100n;
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
        description: `New Hash: ${fixedTx.hash.slice(0, 14)}... (+40% Gas Boost)`,
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

  // Clear Stuck Mempool Nonce
  const handleForceUnstickNonce = async (nonceToClear: number) => {
    if (!sessionPrivateKey || !activeAddress) {
      pushToast({
        type: "error",
        title: "Signer Locked",
        description: "Unlock Vault Signer in the top bar first.",
      });
      return;
    }
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

  // 1. STANDALONE ADMIN AUTHENTICATION GATE (`/admin`)
  if (!isAdminAuthenticated) {
    return (
      <div className="min-h-screen bg-[#05070B] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md p-7 rounded-3xl bg-slate-900/90 border border-indigo-500/30 shadow-2xl space-y-6">
          <div className="flex items-center justify-between">
            <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[10px] font-extrabold uppercase tracking-wider">
              Standalone Route • /admin
            </span>
            <Link
              href="/"
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Wallet
            </Link>
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              <Terminal className="w-6 h-6 text-indigo-400" />
              <span>AetherVault Admin Ops</span>
            </h1>
            <p className="text-xs text-slate-400">
              Dedicated transaction monitoring & failed transaction recovery console.
            </p>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Administrator Authorization Key
              </label>
              <input
                data-testid="admin-passcode-input"
                type="password"
                autoComplete="off"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Enter authorization key"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            {keystore && !sessionPrivateKey && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Vault Keystore Password (Optional — required to sign tx fixes)
                </label>
                <input
                  type="password"
                  value={vaultPasswordInput}
                  onChange={(e) => setVaultPasswordInput(e.target.value)}
                  placeholder="Enter wallet password to enable 1-click tx repair..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {authError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                {authError}
              </div>
            )}

            <button
              data-testid="btn-enter-admin"
              type="submit"
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 font-bold text-sm shadow-lg shadow-indigo-600/25 transition"
            >
              Authenticate & Launch Admin Console
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 2. WIDESCREEN STANDALONE ADMIN COMMAND CENTER (`/admin`)
  return (
    <div className="min-h-screen bg-[#05070B] text-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Navigation & Signer Status Bar */}
        <header className="p-5 rounded-3xl bg-slate-900/90 border border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-indigo-500/20 border border-indigo-500/40">
              <Activity className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold">
                  AetherVault Admin Command Center
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold">
                  /admin
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Real-Time IN/OUT Mempool Monitor, Nonce Diagnostics & Failed Transaction Fixer
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Network Switcher */}
            <select
              value={activeChainId}
              onChange={(e) =>
                setActiveChainId(Number(e.target.value) as SupportedChainId)
              }
              className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-white"
            >
              {Object.entries(CHAIN_METADATA).map(([id, meta]) => (
                <option key={id} value={id}>
                  {meta.name} (Chain {id})
                </option>
              ))}
            </select>

            {/* Signer Unlock Pill if Locked */}
            {sessionPrivateKey ? (
              <span className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> Signer Ready
              </span>
            ) : (
              <form
                onSubmit={handleUnlockSignerInAdmin}
                className="flex items-center gap-1.5"
              >
                <input
                  type="password"
                  value={vaultPasswordInput}
                  onChange={(e) => setVaultPasswordInput(e.target.value)}
                  placeholder="Vault password to sign fixes..."
                  className="px-3 py-1.5 rounded-xl bg-slate-950 border border-amber-500/40 text-xs"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1"
                >
                  <Lock className="w-3 h-3" /> Unlock Signer
                </button>
              </form>
            )}

            <Link
              href="/"
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Open User Wallet (/)
            </Link>

            <button
              onClick={async () => {
                await logoutAdminServerAction();
                setIsAdminAuthenticated(false);
              }}
              className="px-3 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" /> Lock Admin
            </button>
          </div>
        </header>

        {/* Monitored Wallet Address Bar & Chain Sync */}
        <div className="p-4 rounded-3xl bg-slate-900/75 border border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[260px] flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-xs text-slate-400 shrink-0">
              Monitored Address:
            </span>
            <input
              type="text"
              value={monitoredAddressInput}
              onChange={(e) => setMonitoredAddressInput(e.target.value)}
              placeholder="0x... wallet address to inspect"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={syncMempoolAndIncomingLogs}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold flex items-center gap-1.5 shadow-md"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isScanningChain ? "animate-spin" : ""
                }`}
              />
              <span>Scan Blockchain & Mempool</span>
            </button>
          </div>
        </div>

        {/* 4-Column Telemetry & Nonce Health Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-3xl bg-slate-900/80 border border-white/10">
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <ArrowDownLeft className="w-4 h-4 text-emerald-400" /> Incoming
              Transactions (IN)
            </div>
            <div className="text-3xl font-extrabold text-emerald-400 mt-2">
              {stats.inCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Confirmed deposits & token transfers
            </div>
          </div>

          <div className="p-5 rounded-3xl bg-slate-900/80 border border-white/10">
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <ArrowUpRight className="w-4 h-4 text-indigo-400" /> Outgoing
              Transactions (OUT)
            </div>
            <div className="text-3xl font-extrabold text-indigo-300 mt-2">
              {stats.outCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Sends, swaps & contract calls
            </div>
          </div>

          <div className="p-5 rounded-3xl bg-slate-900/80 border border-white/10">
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" /> Failed or Stuck
              Queue
            </div>
            <div className="text-3xl font-extrabold text-amber-400 mt-2">
              {stats.failedOrStuck}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Eligible for 1-Click Gas Boost Repair
            </div>
          </div>

          <div className="p-5 rounded-3xl bg-slate-900/80 border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Account Nonce & Gas</span>
              <span className="font-mono text-emerald-400">
                {currentBaseFeeGwei} Gwei
              </span>
            </div>
            <div className="text-sm font-mono font-bold text-white">
              Mined: #{onChainNonce} | Pending: #{pendingNonce}
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              Native Gas:{" "}
              {parseFloat(formatEther(nativeBalanceWei)).toFixed(4)} ETH (Block #
              {latestBlockNumber.toString()})
            </div>
            {pendingNonce > onChainNonce && (
              <button
                onClick={() => handleForceUnstickNonce(onChainNonce)}
                className="w-full py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
              >
                Force-Unstick Nonce #{onChainNonce}
              </button>
            )}
          </div>
        </div>

        {/* Filter Bar & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5 p-1 rounded-2xl bg-slate-900 border border-white/10">
            {(
              [
                { id: "ALL", label: "All Activity" },
                { id: "IN", label: "IN (Deposits)" },
                { id: "OUT", label: "OUT (Dispatched)" },
                { id: "FAILED_OR_STUCK", label: "Needs Repair (Failed / Stuck)" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setDirectionFilter(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                  directionFilter === tab.id
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search hash, recipient, sender, or token..."
              className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-900 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Master IN / OUT Transaction Ledger with Repair Controls */}
        {filteredTransactions.length === 0 ? (
          <div className="p-12 rounded-3xl bg-slate-900/60 border border-white/10 text-center text-sm text-slate-400">
            No transactions match the current filter. Click &quot;Scan Blockchain
            &amp; Mempool&quot; above to pull live on-chain transfers.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTransactions.map((tx) => {
              const isProblematic =
                tx.status === "failed" || tx.status === "pending";
              return (
                <div
                  key={tx.hash}
                  className={`p-5 rounded-3xl bg-slate-900/85 border transition flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                    tx.status === "failed"
                      ? "border-rose-500/40"
                      : tx.status === "pending"
                      ? "border-amber-500/40"
                      : "border-white/10"
                  }`}
                >
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`p-3 rounded-2xl shrink-0 ${
                        tx.direction === "IN"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-indigo-500/15 text-indigo-400"
                      }`}
                    >
                      {tx.direction === "IN" ? (
                        <ArrowDownLeft className="w-5 h-5" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                            tx.direction === "IN"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-indigo-500/20 text-indigo-300"
                          }`}
                        >
                          {tx.direction}
                        </span>
                        <span className="text-sm font-bold text-white">
                          {tx.summary}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
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
                          {tx.status === "failed" && (
                            <XCircle className="w-3 h-3" />
                          )}
                          {tx.status.toUpperCase()}
                        </span>
                      </div>

                      <div className="text-xs text-slate-400 font-mono flex flex-wrap items-center gap-3">
                        <span>
                          From: {tx.from.slice(0, 8)}...{tx.from.slice(-6)}
                        </span>
                        <span>→</span>
                        <span>
                          To: {tx.to.slice(0, 8)}...{tx.to.slice(-6)}
                        </span>
                        <span>• Nonce #{tx.nonce}</span>
                        <span>
                          • {new Date(tx.timestamp).toLocaleTimeString()}
                        </span>
                        <a
                          href={tx.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-400 flex items-center gap-1 hover:underline"
                        >
                          {tx.hash.slice(0, 12)}...{" "}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Admin Repair Action Buttons */}
                  {isProblematic && tx.direction === "OUT" && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        disabled={isRepairing}
                        onClick={() => handleOneClickAutoFix(tx)}
                        className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        1-Click Fix & Retry (+40% Gas)
                      </button>

                      <button
                        onClick={() => openCustomRepairSheet(tx)}
                        className="py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5"
                      >
                        <Wrench className="w-3.5 h-3.5 text-amber-400" />
                        Edit Parameters
                      </button>

                      {tx.status === "pending" && (
                        <button
                          onClick={() => handleForceUnstickNonce(tx.nonce)}
                          className="py-2.5 px-3.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold"
                        >
                          Cancel Nonce #{tx.nonce}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Custom Transaction Repair & Override Modal */}
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

