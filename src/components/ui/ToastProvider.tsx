"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  X,
} from "lucide-react";
import { triggerHaptic } from "@/lib/ui/haptics";

export type ToastType = "success" | "warning" | "error" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue>({
  pushToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (toast.type === "success") triggerHaptic("success");
    else if (toast.type === "error") triggerHaptic("error");
    else if (toast.type === "warning") triggerHaptic("warning");
    else triggerHaptic("light");

    setToasts((prev) => [{ ...toast, id }, ...prev.slice(0, 2)]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md z-[60] pointer-events-none space-y-2"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -15, scale: 0.95 }}
              className="pointer-events-auto p-3.5 rounded-2xl bg-slate-900/95 border border-white/15 backdrop-blur-xl shadow-2xl flex items-start gap-3 text-white"
            >
              {t.type === "success" && (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              {t.type === "warning" && (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              )}
              {t.type === "error" && (
                <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              )}
              {t.type === "info" && (
                <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
              )}

              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold">{t.title}</div>
                {t.description && (
                  <div className="text-[11px] text-slate-300 mt-0.5 break-words">
                    {t.description}
                  </div>
                )}
              </div>

              <button
                onClick={() => dismiss(t.id)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
