"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Ultra-responsive 60fps BottomSheet:
 * Removes heavy backdrop-filter repainting on mobile GPUs and uses a snappy
 * 160ms cubic-bezier hardware-accelerated transform so opening/closing popups never lags.
 */
export default function BottomSheet({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
}: BottomSheetProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown, { passive: true });
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80"
          />

          <motion.div
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{
              type: "tween",
              ease: [0.22, 1, 0.36, 1],
              duration: 0.18,
            }}
            style={{ willChange: "transform" }}
            className="relative z-10 w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-[#0D111A] border-t sm:border border-white/10 p-5 text-white shadow-2xl max-h-[85vh] overflow-y-auto"
          >
            <div className="w-10 h-1 rounded-full bg-slate-700/80 mx-auto mb-3 sm:hidden" />

            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-extrabold tracking-tight">
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-[11px] text-slate-400">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={onClose}
                className="p-2 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
