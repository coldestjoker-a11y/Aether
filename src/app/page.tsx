"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  Repeat,
  Clock,
  Settings,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { useWalletStore } from "@/store/useWalletStore";
import OnboardingView from "@/components/OnboardingView";
import DashboardView from "@/components/DashboardView";
import SwapView from "@/components/SwapView";
import SendView from "@/components/SendView";
import ReceiveDepositView from "@/components/ReceiveDepositView";
import ActivityView from "@/components/ActivityView";
import SettingsView from "@/components/SettingsView";
import { triggerHaptic } from "@/lib/ui/haptics";
import { TokenAsset } from "@/types/wallet";

type ActiveTab =
  | "home"
  | "swap"
  | "send"
  | "receive"
  | "deposit"
  | "activity"
  | "settings";

export default function WalletAppPage() {
  const { activeAddress, isUnlocked, theme, transactions } = useWalletStore();
  const [tab, setTab] = useState<ActiveTab>("home");
  const [selectedTokenForAction, setSelectedTokenForAction] =
    useState<TokenAsset | null>(null);

  if (!activeAddress || !isUnlocked) {
    return <OnboardingView />;
  }

  const pendingCount = transactions.filter((t) => t.status === "pending").length;
  const isSubView = tab === "send" || tab === "receive" || tab === "deposit";

  return (
    <main
      className={`min-h-screen flex justify-center transition-colors duration-300 ${
        theme === "light"
          ? "bg-slate-100 text-slate-900"
          : "bg-vault-bg text-white"
      }`}
    >
      {/* Ambient Background Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-1/3 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md min-h-screen flex flex-col justify-between p-4 relative z-10">
        {isSubView && (
          <div className="mb-3 flex items-center justify-between">
            <button
              onClick={() => {
                triggerHaptic("light");
                setSelectedTokenForAction(null);
                setTab("home");
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/10 text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Portfolio
            </button>
            <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Client-Side Signing</span>
            </div>
          </div>
        )}

        <div className="flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {tab === "home" && (
                <DashboardView
                  onNavigateTab={(sub, tok) => {
                    triggerHaptic("light");
                    setSelectedTokenForAction(tok || null);
                    setTab(sub);
                  }}
                />
              )}
              {tab === "swap" && <SwapView />}
              {tab === "send" && (
                <SendView preselectedToken={selectedTokenForAction} />
              )}
              {tab === "receive" && (
                <ReceiveDepositView
                  initialMode="receive"
                  preselectedToken={selectedTokenForAction}
                />
              )}
              {tab === "deposit" && (
                <ReceiveDepositView
                  initialMode="deposit"
                  preselectedToken={selectedTokenForAction}
                />
              )}
              {tab === "activity" && <ActivityView />}
              {tab === "settings" && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Consumer 4-Tab Bottom Navigation Bar */}
        <nav
          aria-label="Bottom Navigation"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md px-3 py-2 rounded-3xl bg-slate-900/90 border border-white/10 backdrop-blur-2xl flex items-center justify-around shadow-2xl z-40"
        >
          {[
            { id: "home", label: "Home", icon: Home },
            { id: "swap", label: "Swap", icon: Repeat },
            { id: "activity", label: "Activity", icon: Clock },
            { id: "settings", label: "Settings", icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const active =
              tab === item.id ||
              (item.id === "home" &&
                (tab === "send" || tab === "receive" || tab === "deposit"));

            return (
              <button
                key={item.id}
                data-testid={`nav-${item.id}`}
                onClick={() => {
                  triggerHaptic("light");
                  setSelectedTokenForAction(null);
                  setTab(item.id as ActiveTab);
                }}
                className={`relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl transition ${
                  active
                    ? "text-white font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="activeBottomNavPill"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className="absolute inset-0 rounded-2xl bg-indigo-600/25 border border-indigo-500/40"
                  />
                )}
                <div className="relative z-10">
                  <Icon
                    className={`w-5 h-5 ${
                      active ? "text-indigo-400" : "text-slate-400"
                    }`}
                  />
                  {item.id === "activity" && pendingCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[9px] font-extrabold animate-pulse">
                      {pendingCount}
                    </span>
                  )}
                </div>
                <span className="relative z-10 text-[11px]">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </main>
  );
}
