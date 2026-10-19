"use client";

import React from "react";

interface AetherWaveLoaderProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  sublabel?: string;
}

/**
 * Ultra-fast, zero-lag GPU-accelerated Aether Wave Circle.
 * Uses strictly `transform: scale3d()` and `opacity` keyframes so it never blocks the main thread.
 */
export default function AetherWaveLoader({
  size = "md",
  label,
  sublabel,
}: AetherWaveLoaderProps) {
  const dimensions =
    size === "sm" ? "w-5 h-5" : size === "lg" ? "w-16 h-16" : "w-10 h-10";

  return (
    <div className="inline-flex items-center gap-3 select-none">
      <div className={`relative flex items-center justify-center ${dimensions}`}>
        {/* Outer Wavy Ripple 1 */}
        <span
          className="absolute inset-0 rounded-full border border-indigo-400/70 will-change-transform animate-[ping_1.35s_cubic-bezier(0,0,0.2,1)_infinite]"
          style={{
            boxShadow: "0 0 14px rgba(99, 102, 241, 0.45)",
          }}
        />
        {/* Middle Wavy Ripple 2 (Phase-shifted) */}
        <span
          className="absolute inset-1 rounded-full border border-emerald-400/70 will-change-transform animate-[ping_1.35s_cubic-bezier(0,0,0.2,1)_infinite]"
          style={{
            animationDelay: "0.42s",
            boxShadow: "0 0 12px rgba(16, 185, 129, 0.4)",
          }}
        />
        {/* Inner Rotating Wavy Aura */}
        <span className="absolute inset-1.5 rounded-full bg-gradient-to-tr from-indigo-500 via-violet-500 to-emerald-400 opacity-85 animate-spin will-change-transform" />
        {/* Solid Aether Core */}
        <span className="relative w-2/5 h-2/5 rounded-full bg-white shadow-[0_0_10px_#ffffff]" />
      </div>

      {(label || sublabel) && (
        <div className="text-left leading-tight">
          {label && (
            <div className="text-xs font-extrabold tracking-wide bg-gradient-to-r from-white via-indigo-200 to-emerald-300 bg-clip-text text-transparent">
              {label}
            </div>
          )}
          {sublabel && (
            <div className="text-[10px] text-slate-400 mt-0.5">{sublabel}</div>
          )}
        </div>
      )}
    </div>
  );
}

