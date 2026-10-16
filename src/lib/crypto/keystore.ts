import { Address } from "viem";
import { EncryptedKeystore } from "@/types/wallet";

const PBKDF2_ITERATIONS = 310_000; // OWASP 2024+ recommended minimum for PBKDF2-HMAC-SHA256

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesGcmKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a mnemonic phrase or hex private key in-browser using WebCrypto AES-GCM.
 * Never logs or persists plaintext secrets.
 */
export async function encryptSecretToKeystore(
  secretPlaintext: string,
  password: string,
  address: Address,
  sourceType: "mnemonic" | "privateKey"
): Promise<EncryptedKeystore> {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesGcmKey(password, salt, PBKDF2_ITERATIONS);

  const encodedSecret = new TextEncoder().encode(secretPlaintext.trim());
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encodedSecret
  );

  // Zero out temporary buffer
  encodedSecret.fill(0);

  return {
    version: 1,
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    address,
    sourceType,
  };
}

/**
 * Decrypts an EncryptedKeystore back into its plaintext secret strictly inside transient memory.
 */
export async function decryptKeystoreSecret(
  keystore: EncryptedKeystore,
  password: string
): Promise<string> {
  try {
    const salt = base64ToBytes(keystore.salt);
    const iv = base64ToBytes(keystore.iv);
    const ciphertext = base64ToBytes(keystore.ciphertext);

    const aesKey = await deriveAesGcmKey(password, salt, keystore.iterations);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      aesKey,
      ciphertext as unknown as BufferSource
    );

    const decoded = new TextDecoder().decode(decryptedBuffer);
    return decoded;
  } catch {
    throw new Error("Invalid password or corrupted keystore.");
  }
}

/**
 * WebAuthn Biometric Passkey Creation helper for optional hardware-backed unlock.
 */
export async function registerBiometricCredential(address: string): Promise<string | null> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return null;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = new TextEncoder().encode(address.slice(0, 16));
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "AetherVault DeFi Wallet" },
        user: {
          id: userId,
          name: address,
          displayName: `AetherVault (${address.slice(0, 6)}...${address.slice(-4)})`,
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    return credential ? credential.id : null;
  } catch {
    return null;
  }
}
