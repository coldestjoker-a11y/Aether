"use client";

import React, { useEffect, useState } from "react";
import { useSpring, useTransform } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

export default function AnimatedNumber({
  value,
  prefix = "",
  suffix = "",
  decimals = 2,
  className = "",
}: AnimatedNumberProps) {
  const spring = useSpring(value, {
    mass: 0.6,
    stiffness: 110,
    damping: 18,
  });

  const display = useTransform(spring, (current) => {
    const safeVal = Number.isFinite(current) ? current : 0;
    return `${prefix}${safeVal.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;
  });

  const [rendered, setRendered] = useState<string>(
    `${prefix}${value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`
  );

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  useEffect(() => {
    const unsubscribe = display.on("change", (latest) => {
      setRendered(latest);
    });
    return () => unsubscribe();
  }, [display]);

  return <span className={`tabular-nums ${className}`}>{rendered}</span>;
}
