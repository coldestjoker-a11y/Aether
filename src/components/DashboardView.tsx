"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  Repeat,
  Droplets,
  TrendingUp,
  TrendingDown,
  Copy,
  Check,
  ChevronDown,
  ShieldCheck,
  Search,
  QrCode,
} from "lucide-react";
import { formatUnits } from "viem";
import { useWalletStore } from "@/store/useWalletStore";
import {
  CHAIN_METADATA,
  getResilientPublicClient,
} from "@/lib/chains/config";
import { priceStream } from "@/lib/prices/websocket";
import { fetchUniversalTokenList } from "@/lib/tokens/registry";
import { SupportedChainId, TokenAsset, TokenBalance } from "@/types/wallet";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import InteractiveChart, { ChartPoint } from "@/components/ui/InteractiveChart";
import BottomSheet from "@/components/ui/BottomSheet";
import { TokenLogo } from "@/components/ui/TokenLogo";
import AetherWaveLoader from "@/components/ui/AetherWaveLoader";
import DappConnectModal from "@/components/DappConnectModal";
import { triggerHaptic, formatFriendlyAddress } from "@/lib/ui/haptics";
import { useToast } from "@/components/ui/ToastProvider";

interface Props {
  onNavigateTab: (
    tab: "swap" | "send" | "receive" | "deposit",
    preselectedToken?: TokenAsset
  ) => void;
}

export default function DashboardView({ onNavigateTab }: Props) {
  const {
    activeAddress,
    activeChainId,
    setActiveChainId,
    customTokens,
    addCustomToken,
    customRpcs,
    currency,
    syncChainBalances,
    getEffectiveTokenBalance,
    getTokenVaultAddress,
    balanceSyncVersion,
  } = useWalletStore();
  const { pushToast } = useToast();

  const [prices, setPrices] = useState<
    Record<string, { price: number; change24h: number }>
  >({});
  const [isLoadingBalances, setIsLoadingBalances] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedAssetAddr, setCopiedAssetAddr] = useState<boolean>(false);
  const [chartTimeframe, setChartTimeframe] = useState<"24H" | "7D" | "1M">(
    "24H"
  );
  const [scrubbedPoint, setScrubbedPoint] = useState<ChartPoint | null>(null);
  const [isNetworkSheetOpen, setIsNetworkSheetOpen] = useState<boolean>(false);
  const [selectedAssetDetail, setSelectedAssetDetail] =
    useState<TokenBalance | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [isDappModalOpen, setIsDappModalOpen] = useState<boolean>(false);

  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchUniversalTokenList(activeChainId).then((tokens) => {
      tokens.forEach((t) => addCustomToken(t));
    });
  }, [activeChainId]);

  const chainTokens = useMemo(
    () => customTokens.filter((t) => t.chainId === activeChainId),
    [customTokens, activeChainId]
  );

  useEffect(() => {
    return priceStream.subscribe((livePrices) => {
      setPrices(livePrices);
    });
  }, []);

  // Listen for instant cross-tab / pair-vault incoming deposits
  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window))
      return;
    const bc = new BroadcastChannel("aethervault_ledger_sync");
    bc.onmessage = () => {
      syncChainBalances(activeChainId);
    };
    return () => bc.close();
  }, [activeChainId]);

  const fetchBalances = async (manual = false) => {
    if (!activeAddress) return;
    if (manual) {
      triggerHaptic("medium");
      setIsRefreshing(true);
    }
    try {
      await syncChainBalances(activeChainId);
      if (manual) {
        pushToast({
          type: "info",
          title: "Portfolio Synced",
          description: `All pair addresses synced on ${CHAIN_METADATA[activeChainId].name}`,
        });
      }
    } finally {
      setIsLoadingBalances(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setIsLoadingBalances(true);
    fetchBalances(false);
    const client = getResilientPublicClient(
      activeChainId,
      customRpcs[activeChainId]
    );
    const unwatch = client.watchBlockNumber({
      onBlockNumber: () => {
        fetchBalances(false);
      },
      pollingInterval: 10_000,
    });
    return () => unwatch();
  }, [activeAddress, activeChainId, chainTokens.length]);

  const currencyMultiplier =
    currency === "EUR" ? 0.92 : currency === "GBP" ? 0.79 : 1;
  const currencySymbol =
    currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";

  const tokenBalances: TokenBalance[] = useMemo(() => {
    return chainTokens
      .map((token) => {
        const raw = getEffectiveTokenBalance(activeChainId, token);
        const formatted = formatUnits(raw, token.decimals);
        const ticker = priceStream.getTokenUsdTicker(token, prices);
        const usdPrice = ticker.price * currencyMultiplier;
        const usdValue = parseFloat(formatted) * usdPrice;

        return {
          ...token,
          rawBalance: raw,
          formattedBalance: parseFloat(formatted).toFixed(4),
          usdPrice,
          priceChange24h: ticker.change24h,
          usdValue,
        };
      })
      .filter(
        (t) =>
          t.symbol.toLowerCase().includes(searchFilter.toLowerCase()) ||
          t.name.toLowerCase().includes(searchFilter.toLowerCase())
      );
  }, [
    chainTokens,
    activeChainId,
    balanceSyncVersion,
    prices,
    currencyMultiplier,
    searchFilter,
  ]);

  const totalPortfolioValue = useMemo(
    () => tokenBalances.reduce((acc, item) => acc + item.usdValue, 0),
    [tokenBalances]
  );

  const weighted24hChange = useMemo(() => {
    if (totalPortfolioValue === 0) {
      return prices.ETHUSDT?.change24h ?? 2.45;
    }
    return (
      tokenBalances.reduce(
        (acc, item) => acc + item.usdValue * item.priceChange24h,
        0
      ) / totalPortfolioValue
    );
  }, [tokenBalances, totalPortfolioValue, prices]);

  const displayedBalance = scrubbedPoint
    ? scrubbedPoint.value
    : totalPortfolioValue;

  const rowVirtualizer = useVirtualizer({
    count: tokenBalances.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
  });

  const copyMasterAddress = () => {
    if (!activeAddress) return;
    navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    triggerHaptic("success");
    pushToast({
      type: "success",
      title: "Master Address Copied",
      description: `${activeAddress} copied to clipboard.`,
    });
    setTimeout(() => setCopied(false), 1800);
  };

  const currentChainMeta = CHAIN_METADATA[activeChainId];
  const selectedTokenDedicatedAddress = selectedAssetDetail
    ? getTokenVaultAddress(selectedAssetDetail)
    : activeAddress;

  return (
    <div className="space-y-5 pb-28">
      {/* Top Interactive Header */}
      <div className="flex items-center justify-between gap-2">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            triggerHaptic("light");
            setIsNetworkSheetOpen(true);
          }}
          className="px-3.5 py-2 rounded-2xl bg-slate-900/90 border border-white/10 text-xs font-bold text-white flex items-center gap-2 hover:border-indigo-500/50 transition shadow-sm"
        >
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: currentChainMeta.color }}
          />
          <span>{currentChainMeta.shortName}</span>
          {currentChainMeta.isTestnet && (
            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px]">
              TESTNET
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </motion.button>

        <div className="flex items-center gap-2">
          {isRefreshing && <AetherWaveLoader size="sm" />}

          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={copyMasterAddress}
            className="px-3.5 py-2 rounded-2xl bg-slate-900/90 border border-white/10 text-xs font-mono flex items-center gap-1.5 hover:border-indigo-500/50 transition"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>{formatFriendlyAddress(activeAddress, 4)}</span>
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-400" />
            )}
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            aria-label="Connect dApp"
            title="Scan dApp QR / WalletConnect"
            onClick={() => {
              triggerHaptic("light");
              setIsDappModalOpen(true);
            }}
            className="p-2.5 rounded-2xl bg-slate-900/90 border border-white/10 hover:border-indigo-500/50 hover:text-indigo-400 text-slate-300 transition"
          >
            <QrCode className="w-4 h-4" />
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            aria-label="Refresh Balances"
            onClick={() => fetchBalances(true)}
            className="p-2.5 rounded-2xl bg-slate-900/90 border border-white/10 hover:text-indigo-400 transition"
          >
            <RefreshCw
              className={`w-4 h-4 ${
                isRefreshing ? "animate-spin text-indigo-400" : "text-slate-300"
              }`}
            />
          </motion.button>
        </div>
      </div>

      {/* Glassmorphism Portfolio Hero Card */}
      <motion.div
        layout
        className="p-6 rounded-3xl bg-gradient-to-br from-indigo-950/80 via-slate-900/95 to-slate-950/95 border border-white/10 shadow-2xl relative overflow-hidden"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-400 font-semibold">
              <span>
                {scrubbedPoint
                  ? `Value at ${scrubbedPoint.timestamp}`
                  : "Total Portfolio Balance"}
              </span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>

            <div className="text-3xl sm:text-4xl font-extrabold tracking-tight mt-1 text-white">
              <AnimatedNumber
                value={displayedBalance}
                prefix={currencySymbol}
                decimals={2}
              />
            </div>
          </div>

          <div
            className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 ${
              weighted24hChange >= 0
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
            }`}
          >
            {weighted24hChange >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            <span>
              {weighted24hChange >= 0 ? "+" : ""}
              {weighted24hChange.toFixed(2)}%
            </span>
          </div>
        </div>

        <InteractiveChart
          baseValue={totalPortfolioValue}
          change24h={weighted24hChange}
          currencySymbol={currencySymbol}
          timeframe={chartTimeframe}
          onTimeframeChange={setChartTimeframe}
          onScrubValue={setScrubbedPoint}
        />

        {/* Quick Action Dock */}
        <div className="grid grid-cols-4 gap-2.5 mt-6">
          {[
            {
              id: "send",
              testId: "quick-btn-send",
              label: "Send",
              icon: ArrowUpRight,
              color: "text-indigo-400",
              bg: "group-hover:bg-indigo-500/20",
            },
            {
              id: "receive",
              testId: "quick-btn-receive",
              label: "Receive",
              icon: ArrowDownLeft,
              color: "text-emerald-400",
              bg: "group-hover:bg-emerald-500/20",
            },
            {
              id: "swap",
              testId: "quick-btn-swap",
              label: "Swap",
              icon: Repeat,
              color: "text-violet-400",
              bg: "group-hover:bg-violet-500/20",
            },
            {
              id: "deposit",
              testId: "quick-btn-deposit",
              label: "Faucet",
              icon: Droplets,
              color: "text-cyan-400",
              bg: "group-hover:bg-cyan-500/20",
            },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <motion.button
                key={action.id}
                data-testid={action.testId}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  triggerHaptic("light");
                  onNavigateTab(
                    action.id as "swap" | "send" | "receive" | "deposit"
                  );
                }}
                className="group flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-slate-900/85 hover:bg-slate-800/90 border border-white/10 transition shadow-md"
              >
                <div
                  className={`p-2 rounded-xl bg-slate-950/80 transition ${action.bg}`}
                >
                  <Icon className={`w-5 h-5 ${action.color}`} />
                </div>
                <span className="text-xs font-semibold text-slate-200">
                  {action.label}
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* Searchable Virtualized Token List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
            <span>Your Assets</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[11px] text-slate-400">
              {tokenBalances.length}
            </span>
          </h3>

          <div className="relative w-44">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter tokens..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div
          ref={parentRef}
          className="max-h-[340px] overflow-y-auto rounded-3xl bg-vault-card border border-vault-border p-2 backdrop-blur-xl"
        >
          {isLoadingBalances ? (
            <div className="py-10 flex flex-col items-center justify-center gap-3">
              <AetherWaveLoader
                size="md"
                label="Aether Syncing Vaults"
                sublabel="Checking per-asset addresses..."
              />
            </div>
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const token = tokenBalances[virtualRow.index];
                const pairAddress = getTokenVaultAddress(token);
                return (
                  <div
                    key={`${token.chainId}-${token.symbol}-${token.address}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setSelectedAssetDetail(token);
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="px-3.5 py-2.5 flex items-center justify-between rounded-2xl hover:bg-slate-800/50 active:scale-[0.99] transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <TokenLogo
                        token={token}
                        size={42}
                        showChainBadge={true}
                      />
                      <div>
                        <div className="text-sm font-bold text-white flex items-center gap-1.5">
                          <span>{token.symbol}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-white/5">
                            {formatFriendlyAddress(pairAddress, 3)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                          <AnimatedNumber
                            value={token.usdPrice}
                            prefix={currencySymbol}
                            decimals={2}
                          />
                          <span
                            className={`font-semibold ${
                              token.priceChange24h >= 0
                                ? "text-emerald-400"
                                : "text-rose-400"
                            }`}
                          >
                            {token.priceChange24h >= 0 ? "+" : ""}
                            {token.priceChange24h.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-bold font-mono text-white">
                        {token.formattedBalance}
                      </div>
                      <div className="text-xs text-slate-400">
                        <AnimatedNumber
                          value={token.usdValue}
                          prefix={currencySymbol}
                          decimals={2}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Network Switcher Sheet */}
      <BottomSheet
        isOpen={isNetworkSheetOpen}
        onClose={() => setIsNetworkSheetOpen(false)}
        title="Select Active Network"
        subtitle="Automatic multi-RPC fallback is enabled for all chains"
      >
        <div className="space-y-2">
          {Object.entries(CHAIN_METADATA).map(([idStr, meta]) => {
            const id = Number(idStr) as SupportedChainId;
            const isSelected = id === activeChainId;
            return (
              <button
                key={id}
                onClick={() => {
                  triggerHaptic("medium");
                  setActiveChainId(id);
                  setIsNetworkSheetOpen(false);
                }}
                className={`w-full p-3.5 rounded-2xl border flex items-center justify-between transition ${
                  isSelected
                    ? "bg-indigo-600/20 border-indigo-500 text-white"
                    : "bg-slate-950/80 border-white/10 text-slate-300 hover:bg-slate-800/60"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div className="text-left">
                    <div className="text-xs font-bold">{meta.name}</div>
                    <div className="text-[11px] text-slate-400">
                      Chain ID: {id}
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <span className="px-2.5 py-1 rounded-full bg-indigo-500 text-white text-[10px] font-bold">
                    Connected
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Clicking Any Token Pair Opens ONLY Send & Receive + Dedicated Pair Address */}
      <BottomSheet
        isOpen={!!selectedAssetDetail}
        onClose={() => setSelectedAssetDetail(null)}
        title={
          selectedAssetDetail
            ? `${selectedAssetDetail.name} (${selectedAssetDetail.symbol})`
            : "Asset"
        }
      >
        {selectedAssetDetail && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TokenLogo
                  token={selectedAssetDetail}
                  size={44}
                  showChainBadge={true}
                />
                <div>
                  <div className="text-xs text-slate-400">Balance</div>
                  <div className="text-xl font-bold font-mono mt-0.5">
                    {selectedAssetDetail.formattedBalance}{" "}
                    {selectedAssetDetail.symbol}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">Value</div>
                <div className="text-lg font-bold text-emerald-400 mt-0.5">
                  {currencySymbol}
                  {selectedAssetDetail.usdValue.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Clean Address Row — No Labels */}
            <div className="p-3 rounded-2xl bg-slate-950/90 border border-white/10 flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-slate-200 truncate">
                {selectedTokenDedicatedAddress}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!selectedTokenDedicatedAddress) return;
                  navigator.clipboard.writeText(selectedTokenDedicatedAddress);
                  setCopiedAssetAddr(true);
                  triggerHaptic("success");
                  setTimeout(() => setCopiedAssetAddr(false), 1800);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-400 text-xs font-semibold flex items-center gap-1 shrink-0"
              >
                {copiedAssetAddr ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {/* Strictly Send & Receive Only */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <motion.button
                whileTap={{ scale: 0.96 }}
                data-testid="asset-sheet-btn-send"
                onClick={() => {
                  const tok = selectedAssetDetail;
                  setSelectedAssetDetail(null);
                  onNavigateTab("send", tok);
                }}
                className="py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 font-bold text-xs text-white flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25"
              >
                <ArrowUpRight className="w-4 h-4" />
                Send
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.96 }}
                data-testid="asset-sheet-btn-receive"
                onClick={() => {
                  const tok = selectedAssetDetail;
                  setSelectedAssetDetail(null);
                  onNavigateTab("receive", tok);
                }}
                className="py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-bold text-xs text-white flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
              >
                <ArrowDownLeft className="w-4 h-4" />
                Receive
              </motion.button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* WalletConnect v2 & dApp Camera QR Modal */}
      <DappConnectModal
        isOpen={isDappModalOpen}
        onClose={() => setIsDappModalOpen(false)}
      />
    </div>
  );
}
