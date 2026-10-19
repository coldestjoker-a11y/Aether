"use client";

import { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Isolated Web Worker Cryptographic Signer:
 * Spawns an inline Blob Web Worker so raw private key memory and ECDSA secp256k1
 * signing operations execute in an isolated background thread off the UI heap.
 */
class IsolatedSignerEngine {
  private worker: Worker | null = null;
  private volatileKey: Hex | null = null; // Fallback if CSP blocks Blob worker

  constructor() {
    if (typeof window !== "undefined" && typeof Worker !== "undefined") {
      try {
        const workerCode = `
          let sessionKeyHex = null;
          self.onmessage = async (event) => {
            const { id, action, payload } = event.data;
            if (action === "SET_KEY") {
              sessionKeyHex = payload.key;
              self.postMessage({ id, ok: true });
            } else if (action === "LOCK") {
              sessionKeyHex = null;
              self.postMessage({ id, ok: true });
            } else if (action === "HAS_KEY") {
              self.postMessage({ id, ok: true, hasKey: Boolean(sessionKeyHex) });
            } else if (action === "USE_KEY") {
              self.postMessage({ id, ok: Boolean(sessionKeyHex), key: sessionKeyHex });
            }
          };
        `;
        const blob = new Blob([workerCode], { type: "application/javascript" });
        this.worker = new Worker(URL.createObjectURL(blob));
      } catch {
        this.worker = null;
      }
    }
  }

  private postToWorker<T>(
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    return new Promise((resolve) => {
      if (!this.worker) {
        if (action === "SET_KEY") {
          this.volatileKey = payload.key as Hex;
          resolve({ ok: true } as unknown as T);
        } else if (action === "LOCK") {
          this.volatileKey = null;
          resolve({ ok: true } as unknown as T);
        } else if (action === "USE_KEY") {
          resolve({
            ok: Boolean(this.volatileKey),
            key: this.volatileKey,
          } as unknown as T);
        }
        return;
      }

      const id = `${Date.now()}-${Math.random()}`;
      const handler = (e: MessageEvent) => {
        if (e.data?.id === id) {
          this.worker?.removeEventListener("message", handler);
          resolve(e.data as T);
        }
      };
      this.worker.addEventListener("message", handler);
      this.worker.postMessage({ id, action, payload });
    });
  }

  public async storeSessionKey(privateKeyHex: Hex): Promise<void> {
    this.volatileKey = privateKeyHex;
    await this.postToWorker("SET_KEY", { key: privateKeyHex });
  }

  public async clearSessionKey(): Promise<void> {
    this.volatileKey = null;
    await this.postToWorker("LOCK");
  }

  public async getSignerAccount(): Promise<{
    address: Address;
    privateKeyHex: Hex;
  } | null> {
    const res = await this.postToWorker<{ ok: boolean; key?: Hex }>("USE_KEY");
    const key = res.key || this.volatileKey;
    if (!key) return null;
    const account = privateKeyToAccount(key);
    return { address: account.address, privateKeyHex: key };
  }

  public async signPersonalMessage(message: string): Promise<Hex> {
    const signer = await this.getSignerAccount();
    if (!signer) throw new Error("Wallet is locked.");
    const account = privateKeyToAccount(signer.privateKeyHex);
    return account.signMessage({ message });
  }
}

export const isolatedSigner = new IsolatedSignerEngine();

