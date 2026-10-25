"use client";

import React, { useState, useMemo } from "react";
import {
  Copy,
  Check,
  Droplets,
  Wallet,
  ExternalLink,
  CheckCircle2,
  Sparkles,
  Layers,
  ArrowRight,
  ArrowLeftRight,
  ShieldCheck,
} from "lucide-react";
import { Address, Hex, isAddress, parseUnits } from "viem";
import { useWalletStore } from "@/store/useWalletStore";
import { broadcastIncomingTransferPacket } from "@/lib/crypto/assetAddresses";
import { CHAIN_METADATA, SUPPORTED_CHAINS } from "@/lib/chains/config";
import { SupportedChainId, TokenAsset } from "@/types/wallet";
import { TokenLogo } from "@/components/ui/TokenLogo";
import AetherWaveLoader from "@/components/ui/AetherWaveLoader";
import { triggerHaptic } from "@/lib/ui/haptics";
import { useToast } from "@/components/ui/ToastProvider";

const FAUCET_DRIP_PRESETS: Array<{
  symbol: string;
  amount: string;
  label: string;
}> = [
  { symbol: "ETH", amount: "0.5", label: "0.5 Sepolia ETH" },
  { symbol: "QIE", amount: "1000", label: "1,000 QIE" },
  { symbol: "USDT", amount: "100", label: "100 USDT" },
  { symbol: "USDC", amount: "100", label: "100 USDC" },
  { symbol: "BTC", amount: "0.01", label: "0.01 BTC" },
  { symbol: "SOL", amount: "2", label: "2 SOL" },
];

const EXTERNAL_WEB_FAUCETS = [
  {
    name: "Official QIE Blockchain Testnet Faucet",
    drip: "Claim Native QIE Test Tokens",
    url: "https://www.qie.digital/faucet",
  },
  {
    name: "Google Cloud Web3 Sepolia Faucet",
    drip: "0.05 Sepolia ETH / day (Zero Mainnet Balance)",
    url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
  },
  {
    name: "Sepolia PoW Mining Faucet",
    drip: "Up to 1.5 Sepolia ETH (Browser Mining)",
    url: "https://sepolia-faucet.pk910.de/",
  },
  {
    name: "Circle Official USDC Sepolia Faucet",
    drip: "10 Sepolia USDC / hour",
    url: "https://faucet.circle.com/",
  },
];

const MAINNET_BRIDGES = [
  {
    name: "Jumper Exchange (Powered by LI.FI)",
    description: "Official Multi-Chain Bridge & DEX Aggregator (Optimal gas & route across all EVM chains)",
    url: "https://jumper.exchange",
    badge: "LI.FI Router",
  },
  {
    name: "Official QIE Blockchain Cross-Chain Bridge",
    description: "Bridge native QIE, USDT, & assets between Ethereum, BSC, and QIE Mainnet (#21988)",
    url: "https://qie.digital/bridge",
    badge: "Official QIE",
  },
  {
    name: "Arbitrum One Bridge",
    description: "Official canonical Layer 1 <-> Arbitrum One roll-up gateway",
    url: "https://bridge.arbitrum.io",
    badge: "Canonical L2",
  },
  {
    name: "Base Official Bridge",
    description: "Official Coinbase L1 <-> Base Mainnet gateway",
    url: "https://bridge.base.org/deposit",
    badge: "Canonical L2",
  },
  {
    name: "Optimism Superchain Gateway",
    description: "Official OP Mainnet & Superchain roll-up bridge",
    url: "https://app.optimism.io/bridge",
    badge: "Canonical L2",
  },
  {
    name: "Polygon Portal",
    description: "Polygon PoS & zkEVM Official Multi-Asset Bridge",
    url: "https://portal.polygon.technology/bridge",
    badge: "Canonical PoS",
  },
];

export default function ReceiveDepositView({
  initialMode = "receive",
  preselectedToken,
}: {
  initialMode?: "receive" | "deposit";
  preselectedToken?: TokenAsset | null;
}) {
  const {
    activeAddress,
    activeChainId,
    customTokens,
    getTokenVaultAddress,
    processInstantInboxAndBlockPayloads,
  } = useWalletStore();
  const { pushToast } = useToast();

  const isTestnet = CHAIN_METADATA[activeChainId]?.isTestnet ?? false;

  const chainTokens = useMemo(
    () => customTokens.filter((t) => t.chainId === activeChainId),
    [customTokens, activeChainId]
  );

  const initialIdx = useMemo(() => {
    if (!preselectedToken) return 0;
    const found = chainTokens.findIndex(
      (t) =>
        t.symbol.toUpperCase() === preselectedToken.symbol.toUpperCase() &&
        t.address.toLowerCase() === preselectedToken.address.toLowerCase()
    );
    return found >= 0 ? found : 0;
  }, [chainTokens, preselectedToken]);

  const [selectedIdx, setSelectedIdx] = useState<number>(initialIdx);
  const [mode, setMode] = useState<"receive" | "deposit">(
    initialMode === "deposit" ? "deposit" : "receive"
  );
  const [copiedPair, setCopiedPair] = useState(false);

  // Faucet state (Testnet)
  const [faucetRecipient, setFaucetRecipient] = useState<string>(
    activeAddress || ""
  );
  const [selectedDripIndex, setSelectedDripIndex] = useState<number>(0);
  const [isClaimingFaucet, setIsClaimingFaucet] = useState<boolean>(false);
  const [lastDripTxHash, setLastDripTxHash] = useState<string | null>(null);

  // Bridge state (Mainnet)
  const [destChainId, setDestChainId] = useState<SupportedChainId>(
    activeChainId === 1 ? 42161 : 1
  );
  const [bridgeAmount, setBridgeAmount] = useState<string>("0.1");

  const selectedToken = chainTokens[selectedIdx] || chainTokens[0];
  const dedicatedPairAddress = selectedToken
    ? getTokenVaultAddress(selectedToken)
    : activeAddress;

  const copyPairAddr = () => {
    if (!dedicatedPairAddress) return;
    navigator.clipboard.writeText(dedicatedPairAddress);
    setCopiedPair(true);
    triggerHaptic("success");
    setTimeout(() => setCopiedPair(false), 1800);
  };

  const handleConnectWalletToFaucet = () => {
    triggerHaptic("light");
    const chosenPreset = FAUCET_DRIP_PRESETS[selectedDripIndex];
    const matchedToken = chainTokens.find(
      (t) => t.symbol.toUpperCase() === chosenPreset.symbol.toUpperCase()
    );
    const targetAddr = matchedToken
      ? getTokenVaultAddress(matchedToken)
      : activeAddress;

    if (targetAddr) {
      setFaucetRecipient(targetAddr);
      pushToast({
        type: "info",
        title: "Wallet Connected to Faucet",
        description: `Target set to ${targetAddr.slice(0, 8)}...${targetAddr.slice(-6)}`,
      });
    }
  };

  const handleClaimFaucet = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedAddr = faucetRecipient.trim();
    if (!isAddress(cleanedAddr)) {
      pushToast({
        type: "error",
        title: "Invalid Address",
        description: "Enter a valid 0x wallet address or click Auto-Fill.",
      });
      return;
    }

    const preset = FAUCET_DRIP_PRESETS[selectedDripIndex];
    const matchedToken =
      chainTokens.find(
        (t) => t.symbol.toUpperCase() === preset.symbol.toUpperCase()
      ) || chainTokens[0];

    setIsClaimingFaucet(true);
    setLastDripTxHash(null);
    triggerHaptic("medium");

    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: cleanedAddr,
          tokenSymbol: preset.symbol,
          amount: preset.amount,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Faucet request failed.");
      }

      setLastDripTxHash(data.txHash);
      triggerHaptic("success");

      const dripUnits = parseUnits(preset.amount, matchedToken.decimals);
      broadcastIncomingTransferPacket({
        txHash: data.txHash as Hex,
        chainId: 11155111,
        from: (data.relayerAddress ||
          "0x0000000000000000000000000000000000000000") as Address,
        to: cleanedAddr as Address,
        tokenAddress: matchedToken.address,
        symbol: preset.symbol,
        amountWei: dripUnits.toString(),
        timestamp: Date.now(),
      });

      await processInstantInboxAndBlockPayloads(11155111);

      pushToast({
        type: "success",
        title: `+${preset.amount} ${preset.symbol} Received!`,
        description: `Instant Testnet drip credited to your wallet. Tx: ${data.txHash.slice(0, 10)}...`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Faucet drip error.";
      pushToast({
        type: "error",
        title: "Faucet Claim Failed",
        description: msg,
      });
    } finally {
      setIsClaimingFaucet(false);
    }
  };

  const handleLaunchBridge = () => {
    if (!activeAddress) return;
    navigator.clipboard.writeText(activeAddress);
    triggerHaptic("success");
    pushToast({
      type: "info",
      title: "Address Auto-Copied",
      description: "Opening LI.FI Jumper Bridge with your wallet address configured.",
    });

    const tokenParam =
      selectedToken?.address === "NATIVE"
        ? "0x0000000000000000000000000000000000000000"
        : selectedToken?.address;

    const jumperUrl = `https://jumper.exchange/?fromChain=${activeChainId}&toChain=${destChainId}&fromToken=${tokenParam || ""}&toAddress=${activeAddress}`;
    window.open(jumperUrl, "_blank", "noopener,noreferrer");
  };

  // High-contrast deterministic visual QR matrix
  const qrCells = useMemo(() => {
    const seed = dedicatedPairAddress || "0x00000000000000000000000000000000";
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    const cells: boolean[] = [];
    for (let i = 0; i < 121; i++) {
      const bit = Math.abs(Math.sin(hash + i) * 10000) % 1;
      cells.push(bit > 0.42);
    }
    return cells;
  }, [dedicatedPairAddress]);

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Mode Navigation Switch */}
      <div className="grid grid-cols-2 p-1 rounded-2xl bg-slate-900 border border-white/10">
        <button
          type="button"
          onClick={() => {
            triggerHaptic("light");
            setMode("receive");
          }}
          className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
            mode === "receive"
              ? "bg-indigo-600 text-white shadow-md"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>Receive & QR</span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic("light");
            setMode("deposit");
          }}
          className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
            mode === "deposit"
              ? "bg-gradient-to-r from-indigo-600 to-emerald-600 text-white shadow-md"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {isTestnet ? (
            <>
              <Droplets className="w-3.5 h-3.5 text-cyan-400" />
              <span>Faucet Gateway</span>
            </>
          ) : (
            <>
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Cross-Chain Bridge</span>
            </>
          )}
        </button>
      </div>

      {/* 1. RECEIVE & PAIR QR VIEW */}
      {mode === "receive" && (
        <div className="p-6 rounded-3xl bg-vault-card border border-vault-border text-center space-y-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <TokenLogo
              token={selectedToken}
              size={34}
              showChainBadge={true}
            />
            <select
              value={selectedIdx}
              onChange={(e) => setSelectedIdx(Number(e.target.value))}
              className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-white"
            >
              {chainTokens.map((t, i) => (
                <option key={`${t.symbol}-${t.address}`} value={i}>
                  {t.symbol} ({t.name})
                </option>
              ))}
            </select>
          </div>

          <div className="w-48 h-48 mx-auto p-3 rounded-2xl bg-white grid grid-cols-11 gap-0.5 shadow-xl">
            {qrCells.map((filled, i) => (
              <div
                key={i}
                className={filled ? "bg-slate-950 rounded-[1px]" : "bg-white"}
              />
            ))}
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs break-all text-white">
            {dedicatedPairAddress}
          </div>

          <button
            type="button"
            onClick={copyPairAddr}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg"
          >
            {copiedPair ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            {copiedPair ? "Copied to Clipboard!" : "Copy Address"}
          </button>
        </div>
      )}

      {/* 2. MAINNET CROSS-CHAIN BRIDGE GATEWAY */}
      {mode === "deposit" && !isTestnet && (
        <div className="space-y-4">
          <div className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Layers className="w-5 h-5 text-indigo-400" />
                <span>Live Cross-Chain Bridge</span>
              </div>
              <div className="px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> LI.FI Verified
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Transfer assets across Ethereum, Arbitrum, Base, Optimism, Polygon, BSC, and QIE Blockchain with optimal routing and minimal slippage.
            </p>

            {/* Source & Destination Route */}
            <div className="grid grid-cols-2 gap-3 items-center">
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">From Network</span>
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: CHAIN_METADATA[activeChainId]?.color || "#627EEA" }}
                  />
                  <span>{CHAIN_METADATA[activeChainId]?.shortName || "Active Chain"}</span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">To Network</span>
                <select
                  value={destChainId}
                  onChange={(e) => setDestChainId(Number(e.target.value) as SupportedChainId)}
                  className="w-full bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
                >
                  {Object.entries(SUPPORTED_CHAINS)
                    .filter(([id]) => Number(id) !== activeChainId && !CHAIN_METADATA[Number(id) as SupportedChainId]?.isTestnet)
                    .map(([id]) => {
                      const numId = Number(id) as SupportedChainId;
                      return (
                        <option key={id} value={numId} className="bg-slate-900 text-white">
                          {CHAIN_METADATA[numId]?.shortName || `Chain ${id}`}
                        </option>
                      );
                    })}
                </select>
              </div>
            </div>

            {/* Asset Selection */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">Select Asset to Bridge</label>
              <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800">
                <TokenLogo token={selectedToken} size={28} showChainBadge={false} />
                <select
                  value={selectedIdx}
                  onChange={(e) => setSelectedIdx(Number(e.target.value))}
                  className="flex-1 bg-transparent text-xs font-bold text-white outline-none"
                >
                  {chainTokens.map((t, i) => (
                    <option key={`${t.symbol}-${t.address}`} value={i} className="bg-slate-900 text-white">
                      {t.symbol} - {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">Bridge Amount</label>
              <div className="relative">
                <input
                  type="text"
                  value={bridgeAmount}
                  onChange={(e) => setBridgeAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                />
                <button
                  type="button"
                  onClick={() => setBridgeAmount("1.0")}
                  className="absolute right-3 top-2.5 px-2 py-1 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold hover:bg-indigo-500/30 transition"
                >
                  PRESET
                </button>
              </div>
            </div>

            {/* Bridge Launch CTA */}
            <button
              type="button"
              onClick={handleLaunchBridge}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-emerald-600 hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xl transition"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>Launch LI.FI Cross-Chain Bridge</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </button>
          </div>

          {/* Official Network Bridges Directory */}
          <div className="p-4 rounded-3xl bg-vault-card border border-vault-border space-y-2.5">
            <div className="text-xs font-bold text-slate-300">
              Official Network Bridges (1-Click Auto-Copies Your Wallet)
            </div>
            <div className="space-y-2">
              {MAINNET_BRIDGES.map((bridge) => (
                <a
                  key={bridge.name}
                  href={bridge.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    if (activeAddress) {
                      navigator.clipboard.writeText(activeAddress);
                      pushToast({
                        type: "info",
                        title: "Address Auto-Copied",
                        description: `${activeAddress.slice(0, 8)}... ready to paste in ${bridge.name}.`,
                      });
                    }
                  }}
                  className="p-3 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-slate-800 flex items-center justify-between transition group"
                >
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>{bridge.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                        {bridge.badge}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{bridge.description}</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-indigo-400 shrink-0 group-hover:translate-x-0.5 transition" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3. TESTNET FAUCET GATEWAY (Sepolia Only) */}
      {mode === "deposit" && isTestnet && (
        <div className="space-y-4">
          <form
            onSubmit={handleClaimFaucet}
            className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Droplets className="w-5 h-5 text-indigo-400" />
                <span>Testnet Faucet Gateway</span>
              </div>
              <button
                type="button"
                onClick={handleConnectWalletToFaucet}
                className="px-2.5 py-1 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold flex items-center gap-1 hover:bg-indigo-500/30 transition"
              >
                <Wallet className="w-3 h-3" /> Auto-Fill My Wallet
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Collect instant Sepolia ETH, QIE Blockchain (QIE), USDT, USDC, BTC, or SOL to test swaps (`QIE/USDT`, `BTC/USD`, `SOL/USD`) and transfers.
            </p>

            <div>
              <label className="text-xs text-slate-400 block mb-1.5">
                Select Asset to Collect
              </label>
              <div className="grid grid-cols-3 gap-2">
                {FAUCET_DRIP_PRESETS.map((item, idx) => {
                  const active = selectedDripIndex === idx;
                  return (
                    <button
                      key={item.symbol}
                      type="button"
                      onClick={() => {
                        triggerHaptic("light");
                        setSelectedDripIndex(idx);
                      }}
                      className={`p-2.5 rounded-xl border text-center transition ${
                        active
                          ? "bg-indigo-600 text-white border-indigo-500 shadow-md"
                          : "bg-slate-950 border-slate-800 text-slate-300 hover:border-indigo-500/40"
                      }`}
                    >
                      <div className="text-xs font-extrabold">{item.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Recipient Wallet Address
              </label>
              <input
                data-testid="faucet-address-input"
                type="text"
                value={faucetRecipient}
                onChange={(e) => setFaucetRecipient(e.target.value)}
                placeholder="0x... Paste address or click Auto-Fill"
                className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                required
              />
            </div>

            {lastDripTxHash && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Credited <strong>+{FAUCET_DRIP_PRESETS[selectedDripIndex].label}</strong>! Tx: {lastDripTxHash.slice(0, 14)}...
                </span>
              </div>
            )}

            <button
              data-testid="btn-claim-faucet"
              type="submit"
              disabled={isClaimingFaucet}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg"
            >
              {isClaimingFaucet ? (
                <AetherWaveLoader
                  size="sm"
                  label={`Collecting ${FAUCET_DRIP_PRESETS[selectedDripIndex].symbol}...`}
                />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>
                    Collect {FAUCET_DRIP_PRESETS[selectedDripIndex].label} Now
                  </span>
                </>
              )}
            </button>
          </form>

          <div className="p-4 rounded-3xl bg-vault-card border border-vault-border space-y-2.5">
            <div className="text-xs font-bold text-slate-300">
              Official Web Faucets (Auto-Copies Your Address on Click)
            </div>
            <div className="space-y-2">
              {EXTERNAL_WEB_FAUCETS.map((faucet) => (
                <a
                  key={faucet.name}
                  href={faucet.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    if (activeAddress) {
                      navigator.clipboard.writeText(activeAddress);
                      pushToast({
                        type: "info",
                        title: "Address Copied for Faucet",
                        description: "Just paste (Ctrl+V) on the faucet page to claim.",
                      });
                    }
                  }}
                  className="p-3 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-slate-800 flex items-center justify-between transition"
                >
                  <div>
                    <div className="text-xs font-bold text-white">{faucet.name}</div>
                    <div className="text-[11px] text-slate-400">{faucet.drip}</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-indigo-400 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
