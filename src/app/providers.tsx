"use client";

import React, { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useWalletStore } from "@/store/useWalletStore";
import { ToastProvider } from "@/components/ui/ToastProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const isUnlocked = useWalletStore((s) => s.isUnlocked);
  const autoLockMinutes = useWalletStore((s) => s.autoLockMinutes);
  const lockWallet = useWalletStore((s) => s.lockWallet);
  const touchActivity = useWalletStore((s) => s.touchActivity);
  const activeSwapBanner = useWalletStore((s) => s.activeSwapBanner);

  useEffect(() => {
    if (!isUnlocked) return;
    const interval = setInterval(() => {
      const lastActive = useWalletStore.getState().lastActiveTimestamp;
      const elapsedMs = Date.now() - lastActive;
      if (elapsedMs > autoLockMinutes * 60 * 1000) {
        lockWallet();
      }
    }, 30_000);

    const handleUserActivity = () => touchActivity();
    window.addEventListener("pointerdown", handleUserActivity, {
      passive: true,
    });
    window.addEventListener("keydown", handleUserActivity, { passive: true });

    return () => {
      clearInterval(interval);
      window.removeEventListener("pointerdown", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
    };
  }, [isUnlocked, autoLockMinutes, lockWallet, touchActivity]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {/* GLOBAL PERSISTENT TOP-CENTER SWAP BANNER:
            Uses `fixed top-4 inset-x-0 flex justify-center` so Framer Motion's transform
            NEVER shifts it to the right, and it stays visible even when switching between Home, Swap, and Activity! */}
        <div className="fixed top-4 inset-x-0 z-[100] flex justify-center px-4 pointer-events-none">
          <AnimatePresence mode="wait">
            {activeSwapBanner && (
              <motion.div
                key={activeSwapBanner.status}
                initial={{ opacity: 0, y: -24, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={`w-full max-w-sm px-4 py-3 rounded-2xl border shadow-2xl backdrop-blur-md flex items-center justify-center gap-2.5 text-xs font-extrabold text-center ${
                  activeSwapBanner.status === "completed"
                    ? "bg-emerald-950/95 border-emerald-500/60 text-emerald-200 shadow-emerald-900/40"
                    : "bg-indigo-950/95 border-indigo-500/60 text-white shadow-indigo-900/40"
                }`}
              >
                {activeSwapBanner.status === "swapping" ? (
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="truncate">{activeSwapBanner.message}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
