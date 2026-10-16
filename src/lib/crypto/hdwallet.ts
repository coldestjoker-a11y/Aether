import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { bytesToHex, Hex } from "viem";
import { privateKeyToAccount, PrivateKeyAccount } from "viem/accounts";

export const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";

export function generateNewMnemonic(): string {
  return bip39.generateMnemonic(wordlist, 128); // 12 words (128-bit entropy)
}

export function isValidMnemonicPhrase(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic.trim().toLowerCase().replace(/\s+/g, " "), wordlist);
}

export function deriveAccountFromMnemonic(
  mnemonic: string,
  accountIndex = 0
): { account: PrivateKeyAccount; privateKeyHex: Hex } {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!isValidMnemonicPhrase(normalized)) {
    throw new Error("Invalid BIP-39 recovery phrase.");
  }

  const seed = bip39.mnemonicToSeedSync(normalized);
  const hdKey = HDKey.fromMasterSeed(seed);
  const childKey = hdKey.derive(`m/44'/60'/0'/0/${accountIndex}`);

  if (!childKey.privateKey) {
    throw new Error("Unable to derive private key from seed.");
  }

  const privateKeyHex = bytesToHex(childKey.privateKey) as Hex;
  const account = privateKeyToAccount(privateKeyHex);

  // Wipe raw seed bytes after derivation
  seed.fill(0);

  return { account, privateKeyHex };
}

export function deriveAccountFromPrivateKey(rawKey: string): {
  account: PrivateKeyAccount;
  privateKeyHex: Hex;
} {
  const cleaned = rawKey.trim();
  const formatted = (cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(formatted)) {
    throw new Error("Private key must be a 64-character hexadecimal string.");
  }
  const account = privateKeyToAccount(formatted);
  return { account, privateKeyHex: formatted };
}
