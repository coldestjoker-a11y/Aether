"use server";

import { cookies, headers } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "aethervault_admin_session";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface RateLimitRecord {
  attempts: number;
  lockedUntil: number;
  lastAttempt: number;
}

// In-memory rate limiting map for admin login attempts
const loginAttempts = new Map<string, RateLimitRecord>();

function getClientIdentifier(): string {
  try {
    const h = headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    return h.get("x-real-ip") || "unknown-client";
  } catch {
    return "unknown-client";
  }
}

function getRequiredAdminPasscode(): string {
  const code = process.env.ADMIN_PASSCODE;
  if (!code || code.length < 16) {
    throw new Error(
      "CRITICAL SECURITY CONFIGURATION ERROR: ADMIN_PASSCODE is missing or shorter than 16 characters."
    );
  }
  return code;
}

function getRequiredSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CRITICAL SECURITY CONFIGURATION ERROR: ADMIN_SESSION_SECRET is missing or shorter than 16 characters."
    );
  }
  return secret;
}

/**
 * Constant-time string equality check using SHA-256 digests
 * to prevent byte-by-byte timing side-channel attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const hashA = crypto.createHash("sha256").update(a, "utf8").digest();
  const hashB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

async function computeHmacSignature(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getRequiredSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies the Administrator Authorization Key strictly on the server.
 * Enforces in-memory brute-force lockout (max 5 failed attempts per 15 minutes)
 * and constant-time passcode validation.
 */
export async function authenticateAdminServerAction(
  passcodeInput: string
): Promise<{ success: boolean; error?: string }> {
  const clientIp = getClientIdentifier();
  const now = Date.now();
  const record = loginAttempts.get(clientIp);

  // 1. Check brute-force lockout
  if (record && record.lockedUntil > now) {
    const minutesLeft = Math.ceil((record.lockedUntil - now) / 60000);
    return {
      success: false,
      error: `Too many failed attempts. Admin portal is locked for this IP. Try again in ${minutesLeft} minute(s).`,
    };
  }

  let expectedPasscode: string;
  try {
    expectedPasscode = getRequiredAdminPasscode();
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Server configuration error.",
    };
  }

  // 2. Constant-time verification
  if (!passcodeInput || !constantTimeEqual(passcodeInput.trim(), expectedPasscode)) {
    const attempts = (record?.attempts ?? 0) + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_DURATION_MS : 0;
    loginAttempts.set(clientIp, {
      attempts,
      lockedUntil,
      lastAttempt: now,
    });

    const remaining = MAX_FAILED_ATTEMPTS - attempts;
    if (remaining <= 0) {
      return {
        success: false,
        error: "Too many failed attempts. Admin portal locked for 15 minutes.",
      };
    }

    return {
      success: false,
      error: `Invalid Administrator Authorization Key. (${remaining} attempt${
        remaining === 1 ? "" : "s"
      } remaining)`,
    };
  }

  // 3. Reset rate limiter upon successful authentication
  loginAttempts.delete(clientIp);

  // 4. Issue cryptographically signed HMAC-SHA256 session cookie
  const expiresAt = now + 1000 * 60 * 60 * 6; // 6-hour operator session
  const payload = `admin_verified:${expiresAt}`;
  const signature = await computeHmacSignature(payload);
  const token = `${payload}.${signature}`;

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 6,
  });

  return { success: true };
}

export async function verifyAdminSessionServerAction(): Promise<boolean> {
  const cookie = cookies().get(COOKIE_NAME)?.value;
  if (!cookie) return false;

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return false;

  const [, expStr] = payload.split(":");
  if (!expStr || Number(expStr) < Date.now()) return false;

  try {
    const expectedSig = await computeHmacSignature(payload);
    return constantTimeEqual(signature, expectedSig);
  } catch {
    return false;
  }
}

export async function logoutAdminServerAction(): Promise<void> {
  cookies().delete(COOKIE_NAME);
}
