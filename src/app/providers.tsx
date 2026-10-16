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
            staleTime: 15_000,
            retry: 2,
          },
        },
      })
  );

  const {
    isUnlocked,
    lastActiveTimestamp,
    autoLockMinutes,
    lockWallet,
    touchActivity,
  } = useWalletStore();

  useEffect(() => {
    if (!isUnlocked) return;
    const interval = setInterval(() => {
      const elapsedMs = Date.now() - lastActiveTimestamp;
      if (elapsedMs > autoLockMinutes * 60 * 1000) {
        lockWallet();
      }
    }, 10_000);

    const handleUserActivity = () => touchActivity();
    window.addEventListener("pointerdown", handleUserActivity);
    window.addEventListener("keydown", handleUserActivity);

    return () => {
      clearInterval(interval);
      window.removeEventListener("pointerdown", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
    };
  }, [isUnlocked, lastActiveTimestamp, autoLockMinutes]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
