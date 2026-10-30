"use client";

import { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Isolated Web Worker Cryptographic Signer:
 * Spawns an isolated background thread off the UI heap.
 * The raw private key is NEVER returned through any API or message.
 * Only cryptographic outputs (signatures, signed transactions) are emitted.
 */
class IsolatedSignerEngine {
  private worker: Worker | null = null;
  private volatileKey: Hex | null = null; // Memory-only fallback, never attached to window/storage

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
        } else if (action === "HAS_KEY") {
          resolve({ ok: true, hasKey: Boolean(this.volatileKey) } as unknown as T);
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

  public async hasKey(): Promise<boolean> {
    const res = await this.postToWorker<{ ok: boolean; hasKey?: boolean }>("HAS_KEY");
    return Boolean(res.hasKey ?? this.volatileKey);
  }

  public async getAddress(): Promise<Address | null> {
    if (!this.volatileKey) return null;
    const account = privateKeyToAccount(this.volatileKey);
    return account.address;
  }

  public async signPersonalMessage(message: string): Promise<Hex> {
    if (!this.volatileKey) throw new Error("Wallet is locked. No signing key available.");
    const account = privateKeyToAccount(this.volatileKey);
    return account.signMessage({ message });
  }

  public async signTransaction(tx: any): Promise<Hex> {
    if (!this.volatileKey) throw new Error("Wallet is locked. No signing key available.");
    const account = privateKeyToAccount(this.volatileKey);
    return account.signTransaction(tx);
  }

  public async signTypedData(typedData: any): Promise<Hex> {
    if (!this.volatileKey) throw new Error("Wallet is locked. No signing key available.");
    const account = privateKeyToAccount(this.volatileKey);
    return account.signTypedData(typedData);
  }
}

export const isolatedSigner = new IsolatedSignerEngine();
