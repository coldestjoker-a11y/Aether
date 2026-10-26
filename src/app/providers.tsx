"use client";

import React, { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

  // Granular Zustand selectors prevent global re-renders when balances or transactions update
  const isUnlocked = useWalletStore((s) => s.isUnlocked);
  const autoLockMinutes = useWalletStore((s) => s.autoLockMinutes);
  const lockWallet = useWalletStore((s) => s.lockWallet);
  const touchActivity = useWalletStore((s) => s.touchActivity);

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
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
