"use client";

import React, { useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { triggerHaptic } from "@/lib/ui/haptics";

export interface ChartPoint {
  timestamp: string;
  value: number;
}

interface InteractiveChartProps {
  baseValue: number;
  change24h: number;
  currencySymbol: string;
  timeframe: "24H" | "7D" | "1M";
  onTimeframeChange: (tf: "24H" | "7D" | "1M") => void;
  onScrubValue?: (point: ChartPoint | null) => void;
}

export default function InteractiveChart({
  baseValue,
  change24h,
  timeframe,
  onTimeframeChange,
  onScrubValue,
}: InteractiveChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const effectiveBase = baseValue > 0 ? baseValue : 2640.5;
  const isPositive = change24h >= 0;

  // Generate smooth, realistic portfolio curve anchored to current live value
  const points = useMemo<ChartPoint[]>(() => {
    const count = 32;
    const startRatio = 1 - change24h / 100;
    const startVal = effectiveBase * startRatio;
    const now = Date.now();
    const stepMs =
      timeframe === "24H"
        ? 45 * 60 * 1000
        : timeframe === "7D"
        ? 5 * 3600 * 1000
        : 22 * 3600 * 1000;

    return Array.from({ length: count }, (_, idx) => {
      const progress = idx / (count - 1);
      const wave =
        Math.sin(progress * Math.PI * (timeframe === "24H" ? 2.5 : 4)) *
          (effectiveBase * 0.018) +
        Math.cos(idx * 0.9) * (effectiveBase * 0.007);
      const interpolated =
        startVal + (effectiveBase - startVal) * progress + (idx === count - 1 ? 0 : wave);

      const date = new Date(now - (count - 1 - idx) * stepMs);
      const label =
        timeframe === "24H"
          ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : date.toLocaleDateString([], { month: "short", day: "numeric" });

      return {
        timestamp: label,
        value: Math.max(interpolated, 0.01),
      };
    });
  }, [effectiveBase, change24h, timeframe]);

  const { pathD, areaD, coords } = useMemo(() => {
    const width = 400;
    const height = 104;
    const padY = 12;

    const vals = points.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;

    const mapped = points.map((pt, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - padY - ((pt.value - min) / range) * (height - padY * 2);
      return { x, y, pt };
    });

    const d = mapped
      .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(" ");

    const area = `${d} L ${width} ${height} L 0 ${height} Z`;
    return { pathD: d, areaD: area, coords: mapped };
  }, [points]);

  const handlePointerMove = (clientX: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = relX / rect.width;
    const idx = Math.round(ratio * (points.length - 1));

    if (idx !== hoverIndex) {
      setHoverIndex(idx);
      triggerHaptic("light");
      onScrubValue?.(points[idx]);
    }
  };

  const clearScrub = () => {
    setHoverIndex(null);
    onScrubValue?.(null);
  };

  const strokeColor = isPositive ? "#10B981" : "#F43F5E";
  const activeCoord = hoverIndex !== null ? coords[hoverIndex] : null;

  return (
    <div className="select-none">
      <div className="relative h-28 w-full mt-3">
        <svg
          ref={svgRef}
          viewBox="0 0 400 104"
          className="w-full h-full overflow-visible cursor-crosshair touch-none"
          onMouseMove={(e) => handlePointerMove(e.clientX)}
          onMouseLeave={clearScrub}
          onTouchMove={(e) => {
            if (e.touches[0]) handlePointerMove(e.touches[0].clientX);
          }}
          onTouchEnd={clearScrub}
        >
          <defs>
            <linearGradient id="interactiveChartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.38" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <path d={areaD} fill="url(#interactiveChartGrad)" />

          <motion.path
            key={timeframe}
            initial={{ pathLength: 0, opacity: 0.5 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.75, ease: "easeOut" }}
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {activeCoord && (
            <>
              <line
                x1={activeCoord.x}
                y1={0}
                x2={activeCoord.x}
                y2={104}
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
              <circle
                cx={activeCoord.x}
                cy={activeCoord.y}
                r="6"
                fill={strokeColor}
                stroke="#07090E"
                strokeWidth="2.5"
              />
            </>
          )}
        </svg>
      </div>

      {/* Timeframe Pills & Live Status */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex gap-1.5 bg-slate-950/70 p-1 rounded-xl border border-white/5">
          {(["24H", "7D", "1M"] as const).map((tf) => {
            const active = timeframe === tf;
            return (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  onTimeframeChange(tf);
                }}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tf}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>
            {activeCoord
              ? `${activeCoord.pt.timestamp}`
              : "Drag chart to inspect"}
          </span>
        </div>
      </div>
    </div>
  );
}
