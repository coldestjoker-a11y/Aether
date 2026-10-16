"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { triggerHaptic } from "@/lib/ui/haptics";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

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
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              triggerHaptic("light");
              onClose();
            }}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
          />

          {/* Sheet Container */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.45 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110) {
                triggerHaptic("light");
                onClose();
              }
            }}
            className="relative w-full max-w-md max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-slate-900/95 border border-white/10 backdrop-blur-2xl shadow-2xl overflow-hidden text-white z-10"
          >
            {/* Mobile Grab Handle */}
            <div className="w-10 h-1.5 bg-slate-700/80 rounded-full mx-auto mt-3 mb-1 sm:hidden" />

            <div className="px-5 pt-3 pb-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold tracking-tight">{title}</h3>
                {subtitle && (
                  <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => {
                  triggerHaptic("light");
                  onClose();
                }}
                className="p-2 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
