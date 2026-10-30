import { describe, it, expect } from "vitest";
import {
  generateNewMnemonic,
  deriveAccountFromMnemonic,
  deriveAccountFromPrivateKey,
  isValidMnemonicPhrase,
} from "@/lib/crypto/hdwallet";
import {
  encryptSecretToKeystore,
  decryptKeystoreSecret,
} from "@/lib/crypto/keystore";
import { encodeErc20Transfer, encodeErc20Approve } from "@/lib/tx/engine";
import { isValidRpcUrl } from "@/lib/chains/config";
import { isolatedSigner } from "@/lib/crypto/signerWorkerClient";
import { priceStream } from "@/lib/prices/websocket";

describe("AetherVault Cryptography & Transaction Unit Suite", () => {
  it("generates a valid 12-word BIP39 mnemonic and deterministically derives m/44'/60'/0'/0/0", () => {
    const phrase = generateNewMnemonic();
    expect(phrase.split(" ").length).toBe(12);
    expect(isValidMnemonicPhrase(phrase)).toBe(true);

    const first = deriveAccountFromMnemonic(phrase, 0);
    const second = deriveAccountFromMnemonic(phrase, 0);
    expect(first.account.address).toBe(second.account.address);
    expect(first.privateKeyHex).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("encrypts and decrypts mnemonic using WebCrypto PBKDF2 + AES-GCM without leaking plaintext", async () => {
    const phrase = generateNewMnemonic();
    const { account } = deriveAccountFromMnemonic(phrase);
    const password = "StrongVaultPassword!2026";

    const keystore = await encryptSecretToKeystore(
      phrase,
      password,
      account.address,
      "mnemonic"
    );

    expect(keystore.cipher).toBe("AES-GCM");
    expect(keystore.kdf).toBe("PBKDF2-SHA256");
    expect(keystore.ciphertext).not.toContain(phrase.split(" ")[0]);

    const decrypted = await decryptKeystoreSecret(keystore, password);
    expect(decrypted).toBe(phrase);

    await expect(
      decryptKeystoreSecret(keystore, "WrongPassword123")
    ).rejects.toThrow("Invalid password or corrupted keystore.");
  });

  it("derives identical address from exported private key", () => {
    const phrase = generateNewMnemonic();
    const { account, privateKeyHex } = deriveAccountFromMnemonic(phrase);
    const fromPk = deriveAccountFromPrivateKey(privateKeyHex);
    expect(fromPk.account.address).toBe(account.address);
  });

  it("encodes deterministic ERC-20 transfer and approve hex calldata", () => {
    const recipient = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const transferHex = encodeErc20Transfer(recipient, 1000000n);
    const approveHex = encodeErc20Approve(recipient, 0n);

    expect(transferHex.startsWith("0xa9059cbb")).toBe(true);
    expect(approveHex.startsWith("0x095ea7b3")).toBe(true);
  });

  it("strictly validates custom RPC URLs to prevent SSRF and private network probing", () => {
    expect(isValidRpcUrl("https://bsc-dataseed.binance.org").valid).toBe(true);
    expect(isValidRpcUrl("wss://bsc-rpc.publicnode.com").valid).toBe(true);

    // Block plain HTTP
    expect(isValidRpcUrl("http://evil-rpc.com").valid).toBe(false);

    // Block javascript: and malicious protocols
    expect(isValidRpcUrl("javascript:alert(1)").valid).toBe(false);

    // Block private and loopback networks
    expect(isValidRpcUrl("https://localhost:8545").valid).toBe(false);
    expect(isValidRpcUrl("https://127.0.0.1:8545").valid).toBe(false);
    expect(isValidRpcUrl("https://192.168.1.1:8545").valid).toBe(false);
    expect(isValidRpcUrl("https://10.0.0.1:8545").valid).toBe(false);
  });

  it("isolated signer signs messages in memory without exposing raw private key", async () => {
    const phrase = generateNewMnemonic();
    const { account, privateKeyHex } = deriveAccountFromMnemonic(phrase);

    await isolatedSigner.storeSessionKey(privateKeyHex);
    expect(await isolatedSigner.hasKey()).toBe(true);

    const derivedAddr = await isolatedSigner.getAddress();
    expect(derivedAddr?.toLowerCase()).toBe(account.address.toLowerCase());

    const sig = await isolatedSigner.signPersonalMessage("AetherVault Security Verification");
    expect(sig.startsWith("0x")).toBe(true);

    await isolatedSigner.clearSessionKey();
    expect(await isolatedSigner.hasKey()).toBe(false);
    await expect(
      isolatedSigner.signPersonalMessage("Test")
    ).rejects.toThrow("Wallet is locked");
  });

  it("returns zero price fallback for unpriced or unknown tokens instead of $1.00", () => {
    const ticker = priceStream.getTokenUsdTicker({
      symbol: "UNKNOWN_MALICIOUS_TOKEN",
    });
    expect(ticker.price).toBe(0);
  });
});
