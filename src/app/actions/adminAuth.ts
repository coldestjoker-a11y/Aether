"use server";

import { cookies } from "next/headers";

const COOKIE_NAME = "aethervault_admin_session";

function getServerPasscode(): string {
  return process.env.ADMIN_PASSCODE || "admin2026/cold121.";
}

function getSessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    "aethervault-hmac-256-production-secret-key-2026"
  );
}

async function computeHmacSignature(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSessionSecret()),
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
 * Verifies the Administrator Authorization Key strictly on the server
 * and issues an httpOnly, Secure, SameSite=Strict cookie.
 */
export async function authenticateAdminServerAction(
  passcodeInput: string
): Promise<{ success: boolean; error?: string }> {
  const expected = getServerPasscode();

  if (!passcodeInput || passcodeInput !== expected) {
    return { success: false, error: "Invalid Administrator Authorization Key." };
  }

  const expiresAt = Date.now() + 1000 * 60 * 60 * 6; // 6-hour operator session
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
  if (Number(expStr) < Date.now()) return false;

  const expectedSig = await computeHmacSignature(payload);
  return signature === expectedSig;
}

export async function logoutAdminServerAction(): Promise<void> {
  cookies().delete(COOKIE_NAME);
}

