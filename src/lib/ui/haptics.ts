"use client";

export type HapticStyle = "light" | "medium" | "heavy" | "success" | "warning" | "error";

/**
 * Triggers subtle hardware haptic feedback on supported mobile devices
 * while remaining completely safe on desktop browsers.
 */
export function triggerHaptic(style: HapticStyle = "light"): void {
  if (typeof window === "undefined" || !("vibrate" in navigator)) return;

  try {
    switch (style) {
      case "light":
        navigator.vibrate(8);
        break;
      case "medium":
        navigator.vibrate(18);
        break;
      case "heavy":
        navigator.vibrate(35);
        break;
      case "success":
        navigator.vibrate([12, 40, 20]);
        break;
      case "warning":
        navigator.vibrate([25, 50, 25]);
        break;
      case "error":
        navigator.vibrate([45, 40, 45, 40, 60]);
        break;
    }
  } catch {
    // Ignore on unsupported devices
  }
}

export function formatFriendlyAddress(address?: string | null, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}
