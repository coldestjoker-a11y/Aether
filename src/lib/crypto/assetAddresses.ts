import {
  Address,
  encodeAbiParameters,
  decodeAbiParameters,
  getAddress,
  Hex,
  keccak256,
  parseAbiParameters,
  slice,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SupportedChainId, TokenAsset } from "@/types/wallet";

// 4-byte magic prefix for on-chain AetherVault Synthetic Token Settlement (`0xa3746572`)
export const AETHER_TRANSFER_MAGIC = "0xa3746572";

const AETHER_PAYLOAD_PARAMS = parseAbiParameters(
  "string symbol, address tokenContract, uint256 amount, address recipient"
);

/**
 * Deterministically derives a unique, valid EIP-55 Ethereum/EVM address and signing key
 * for EACH token pair (`ETH`, `USDC`, `USDT`, `LINK`, `UNI`, etc.) from the user's session key
 * or master address.
 *
 * - Native `ETH` uses index 0 (your primary wallet address).
 * - Every ERC-20 token (`USDC`, `USDT`, `LINK`, etc.) gets its own dedicated sub-vault address
 *   so every asset pair has a distinct Receive & Send address!
 */
export function deriveAssetVaultAccount(params: {
  masterAddress: Address;
  sessionPrivateKey?: Hex | null;
  token: Pick<TokenAsset, "symbol" | "address" | "chainId">;
}): {
  vaultAddress: Address;
  vaultPrivateKey: Hex | null;
  isSubVault: boolean;
} {
  const sym = params.token.symbol.toUpperCase();

  // Native gas token stays on Master Address so gas is always available
  if (params.token.address === "NATIVE" && sym === "ETH") {
    return {
      vaultAddress: params.masterAddress,
      vaultPrivateKey: params.sessionPrivateKey || null,
      isSubVault: false,
    };
  }

  // Deterministic child key derivation when unlocked with sessionPrivateKey
  if (params.sessionPrivateKey) {
    const domainSeed = keccak256(
      toBytes(
        `${params.sessionPrivateKey.toLowerCase()}:AETHER_ASSET_VAULT:${sym}`
      )
    );
    const childAccount = privateKeyToAccount(domainSeed);
    return {
      vaultAddress: childAccount.address,
      vaultPrivateKey: domainSeed,
      isSubVault: true,
    };
  }

  // Deterministic read-only fallback when locked
  const hash = keccak256(
    toBytes(`${params.masterAddress.toLowerCase()}:AETHER_PUBLIC_VAULT:${sym}`)
  );
  const rawAddr = slice(hash, 12, 32);
  return {
    vaultAddress: getAddress(rawAddr),
    vaultPrivateKey: null,
    isSubVault: true,
  };
}

/**
 * Encodes an on-chain AetherVault token transfer payload so when sending swapped Sepolia USDC
 * (or any testnet asset), the exact token symbol, contract address, and amount are permanently
 * written into the blockchain transaction `data` field and automatically credited by the recipient wallet.
 */
export function encodeAetherTransferPayload(params: {
  symbol: string;
  tokenAddress: Address | "NATIVE";
  amountWei: bigint;
  recipient: Address;
}): Hex {
  const contractAddr: Address =
    params.tokenAddress === "NATIVE"
      ? "0x0000000000000000000000000000000000000000"
      : params.tokenAddress;

  const encoded = encodeAbiParameters(AETHER_PAYLOAD_PARAMS, [
    params.symbol.toUpperCase(),
    contractAddr,
    params.amountWei,
    params.recipient,
  ]);

  return `${AETHER_TRANSFER_MAGIC}${encoded.slice(2)}` as Hex;
}

export function decodeAetherTransferPayload(data: Hex): {
  symbol: string;
  tokenContract: Address;
  amountWei: bigint;
  recipient: Address;
} | null {
  if (!data || !data.startsWith(AETHER_TRANSFER_MAGIC) || data.length < 10) {
    return null;
  }
  try {
    const rawAbiHex = `0x${data.slice(10)}` as Hex;
    const [symbol, tokenContract, amountWei, recipient] = decodeAbiParameters(
      AETHER_PAYLOAD_PARAMS,
      rawAbiHex
    );
    return {
      symbol,
      tokenContract,
      amountWei,
      recipient,
    };
  } catch {
    return null;
  }
}

/**
 * Instant Cross-Tab & Local Recipient Delivery Bus:
 * Ensures transfers sent to any address or sub-vault address in another tab/window
 * or within your own pair vaults land in < 50ms alongside the on-chain transaction.
 */
export interface InstantTransferPacket {
  txHash: Hex;
  chainId: SupportedChainId;
  from: Address;
  to: Address;
  symbol: string;
  tokenAddress: Address | "NATIVE";
  amountWei: string;
  timestamp: number;
}

const INBOX_STORAGE_KEY = "aethervault-global-transfer-inbox-v1";

export function broadcastIncomingTransferPacket(packet: InstantTransferPacket) {
  if (typeof window === "undefined") return;
  try {
    const existingRaw = localStorage.getItem(INBOX_STORAGE_KEY);
    const list: InstantTransferPacket[] = existingRaw
      ? JSON.parse(existingRaw)
      : [];
    const deduplicated = [
      packet,
      ...list.filter(
        (p) => p.txHash.toLowerCase() !== packet.txHash.toLowerCase()
      ),
    ].slice(0, 100);
    localStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(deduplicated));

    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel("aethervault_ledger_sync");
      bc.postMessage(packet);
      bc.close();
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function readIncomingTransferPackets(): InstantTransferPacket[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(INBOX_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

