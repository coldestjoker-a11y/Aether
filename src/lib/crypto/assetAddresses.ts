import {
  Address,
  encodeAbiParameters,
  decodeAbiParameters,
  getAddress,
  Hex,
  keccak256,
  parseAbiParameters,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SupportedChainId, TokenAsset } from "@/types/wallet";

export const AETHER_TRANSFER_MAGIC = "0xa3746572";

const AETHER_PAYLOAD_PARAMS = parseAbiParameters(
  "string symbol, address tokenContract, uint256 amount, address recipient"
);

/**
 * CRITICAL FIX FOR REAL MAINNET & TESTNET DEPOSITS:
 * 1. Returns your canonical, EIP-55 checksummed BIP-44 account address (`masterAddress`)
 *    for all EVM tokens (ETH, USDC, USDT, WBTC, LINK, UNI, QIE, etc.).
 *    - Guarantees 100% compatibility with Exchanges (Binance, Coinbase, Bybit), Bridges, and Faucets.
 *    - Guarantees that your Native ETH gas is in the exact same account as your USDC.
 *    - Never generates an unspendable keyless hash when locked.
 * 2. Also exposes `legacySubVaultAddress` & `legacySubVaultPrivateKey` so if you already
 *    deposited USDC to the previous sub-vault address while unlocked, the wallet STILL
 *    reads, displays, and can spend/sweep that balance!
 */
export function deriveAssetVaultAccount(params: {
  masterAddress: Address;
  sessionPrivateKey?: Hex | null;
  token: Pick<TokenAsset, "symbol" | "address" | "chainId">;
}): {
  vaultAddress: Address;
  vaultPrivateKey: Hex | null;
  isSubVault: boolean;
  legacySubVaultAddress: Address | null;
  legacySubVaultPrivateKey: Hex | null;
} {
  const checksummedMaster = getAddress(params.masterAddress);
  const sym = params.token.symbol.toUpperCase();

  let legacySubVaultAddress: Address | null = null;
  let legacySubVaultPrivateKey: Hex | null = null;

  if (params.sessionPrivateKey && sym !== "ETH") {
    try {
      const domainSeed = keccak256(
        toBytes(
          `${params.sessionPrivateKey.toLowerCase()}:AETHER_ASSET_VAULT:${sym}`
        )
      );
      const childAccount = privateKeyToAccount(domainSeed);
      legacySubVaultAddress = childAccount.address;
      legacySubVaultPrivateKey = domainSeed;
    } catch {
      legacySubVaultAddress = null;
      legacySubVaultPrivateKey = null;
    }
  }

  return {
    vaultAddress: checksummedMaster,
    vaultPrivateKey: params.sessionPrivateKey || null,
    isSubVault: false,
    legacySubVaultAddress,
    legacySubVaultPrivateKey,
  };
}

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
