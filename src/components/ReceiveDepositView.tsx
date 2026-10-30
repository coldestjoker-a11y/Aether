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
  AlertCircle,
  Layers,
  ArrowRight,
} from "lucide-react";
import { Address, getAddress, Hex, isAddress, parseUnits } from "viem";
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

function sanitizeEthAddress(addr: string): Address | null {
  if (!addr) return null;
  const cleaned = addr.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(cleaned) && isAddress(cleaned, { strict: false })) {
    try {
      return getAddress(cleaned);
    } catch {
      return null;
    }
  }
  return null;
}

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
  const [mode, setMode] = useState<"receive" | "deposit" | "faucet">(
    initialMode === "deposit" ? (isTestnet ? "faucet" : "deposit") : "receive"
  );
  const [copiedPair, setCopiedPair] = useState(false);

  // Faucet state
  const [faucetRecipient, setFaucetRecipient] = useState<string>(activeAddress || "");
  const [selectedDripIndex, setSelectedDripIndex] = useState<number>(0);
  const [isClaimingFaucet, setIsClaimingFaucet] = useState<boolean>(false);
  const [lastDripTxHash, setLastDripTxHash] = useState<string | null>(null);
  const [faucetError, setFaucetError] = useState<string | null>(null);

  // Bridge state
  const [destChainId, setDestChainId] = useState<SupportedChainId>(
    activeChainId === 1 ? 42161 : 1
  );

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
    setFaucetError(null);
    if (activeAddress) {
      setFaucetRecipient(activeAddress);
      pushToast({
        type: "info",
        title: "Wallet Address Connected",
        description: `Set to ${activeAddress.slice(0, 8)}...${activeAddress.slice(-6)}`,
      });
    }
  };

  const handleClaimFaucet = async (e: React.FormEvent) => {
    e.preventDefault();
    setFaucetError(null);
    setLastDripTxHash(null);

    const validAddress = sanitizeEthAddress(faucetRecipient);
    if (!validAddress) {
      const msg = "Please enter a valid 0x address (e.g. 0x190EC1... or click Auto-Fill).";
      setFaucetError(msg);
      pushToast({
        type: "error",
        title: "Invalid Address",
        description: msg,
      });
      return;
    }

    const preset = FAUCET_DRIP_PRESETS[selectedDripIndex];
    const matchedToken =
      chainTokens.find(
        (t) => t.symbol.toUpperCase() === preset.symbol.toUpperCase()
      ) || chainTokens[0];

    setIsClaimingFaucet(true);
    triggerHaptic("medium");

    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: validAddress,
          symbol: preset.symbol,
          amount: preset.amount,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.txHash) {
        throw new Error(data.error || "Faucet claim failed.");
      }

      const amountWei = parseUnits(preset.amount, matchedToken?.decimals ?? 18);
      broadcastIncomingTransferPacket({
        txHash: data.txHash as Hex,
        chainId: activeChainId,
        from: "0x0000000000000000000000000000000000FA0CE7" as Address,
        to: validAddress,
        symbol: matchedToken?.symbol ?? preset.symbol,
        tokenAddress: matchedToken?.address ?? "NATIVE",
        amountWei: amountWei.toString(),
        timestamp: Date.now(),
      });

      await processInstantInboxAndBlockPayloads(activeChainId);

      setLastDripTxHash(data.txHash);
      triggerHaptic("success");
      pushToast({
        type: "success",
        title: `Faucet Credited: +${preset.amount} ${preset.symbol}!`,
        description: `Delivered to ${validAddress.slice(0, 6)}...${validAddress.slice(-4)}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not claim faucet.";
      setFaucetError(msg);
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

  const qrCells = Array.from({ length: 121 }, (_, idx) => {
    const addr = dedicatedPairAddress || "0x0";
    const charCode = addr.charCodeAt(idx % addr.length);
    return (charCode + idx) % 2 === 0;
  });

  return (
    <div className="space-y-4 pb-28">
      <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-900 border border-slate-800">
        <button
          type="button"
          onClick={() => setMode("receive")}
          className={`py-2.5 rounded-xl text-xs font-bold transition ${
            mode === "receive" ? "bg-indigo-600 text-white" : "text-slate-400"
          }`}
        >
          Receive QR
        </button>
        <button
          type="button"
          onClick={() => setMode(isTestnet ? "faucet" : "deposit")}
          className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
            mode === "deposit" || mode === "faucet" ? "bg-indigo-600 text-white" : "text-slate-400"
          }`}
        >
          {isTestnet ? (
            <>
              <Droplets className="w-3.5 h-3.5" />
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

      {mode === "receive" && (
        <div className="p-6 rounded-3xl bg-vault-card border border-vault-border text-center space-y-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <TokenLogo token={selectedToken} size={34} showChainBadge={true} />
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
            {copiedPair ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedPair ? "Copied!" : "Copy Address"}
          </button>
        </div>
      )}

      {/* Mainnet Cross-Chain Bridge */}
      {mode === "deposit" && !isTestnet && (
        <div className="space-y-4">
          <div className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Layers className="w-5 h-5 text-indigo-400" />
                <span>Live Cross-Chain Bridge</span>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-mono">
                LI.FI / Jumper Protocol
              </span>
            </div>

            <p className="text-xs text-slate-400">
              Bridge real native assets and tokens directly into your wallet from any EVM network.
            </p>

            <div className="p-4 rounded-2xl bg-slate-950/80 border border-white/5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Source Network</span>
                <span className="font-bold text-white">
                  {CHAIN_METADATA[activeChainId]?.name ?? "Current Chain"}
                </span>
              </div>

              <div className="flex justify-center my-1">
                <ArrowRight className="w-4 h-4 text-indigo-400 rotate-90" />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1.5">
                  Destination Network
                </label>
                <select
                  value={destChainId}
                  onChange={(e) => setDestChainId(Number(e.target.value) as SupportedChainId)}
                  className="w-full px-3.5 py-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-white"
                >
                  {Object.entries(CHAIN_METADATA)
                    .filter(([id, meta]) => Number(id) !== activeChainId && !meta.isTestnet)
                    .map(([id, meta]) => (
                      <option key={id} value={id}>
                        {meta.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLaunchBridge}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 transition"
            >
              <span>Launch Jumper Multi-Chain Bridge</span>
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-3">
            <h3 className="text-xs font-bold text-slate-300">
              Official Canonical Bridges
            </h3>
            <div className="space-y-2">
              {MAINNET_BRIDGES.map((b) => (
                <a
                  key={b.name}
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-slate-800 flex items-center justify-between transition group"
                >
                  <div>
                    <div className="text-xs font-bold text-white group-hover:text-indigo-300 transition">
                      {b.name}
                    </div>
                    <div className="text-[11px] text-slate-400">{b.description}</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Faucet Gateway View */}
      {(mode === "faucet" || (mode === "deposit" && isTestnet)) && (
        <div className="space-y-4">
          <form
            onSubmit={handleClaimFaucet}
            className="p-5 rounded-3xl bg-vault-card border border-vault-border space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold">
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
              Collect instant Sepolia ETH, QIE, USDT, USDC, BTC, or SOL testnet tokens.
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
                onChange={(e) => {
                  setFaucetRecipient(e.target.value);
                  setFaucetError(null);
                }}
                placeholder="0x... Paste address or click Auto-Fill"
                className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
                required
              />
            </div>

            {faucetError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{faucetError}</span>
              </div>
            )}

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
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-40"
            >
              {isClaimingFaucet ? (
                <AetherWaveLoader
                  size="sm"
                  label={`Collecting ${FAUCET_DRIP_PRESETS[selectedDripIndex].symbol}...`}
                />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Collect {FAUCET_DRIP_PRESETS[selectedDripIndex].label} Now</span>
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
