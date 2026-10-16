import { Address, Hex } from "viem";

export type SupportedChainId = 11155111 | 1 | 56 | 137 | 42161 | 8453 | 10;

export interface EncryptedKeystore {
  version: 1;
  cipher: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;       // Base64
  iv: string;         // Base64
  ciphertext: string; // Base64
  address: Address;
  sourceType: "mnemonic" | "privateKey";
}

export interface TokenAsset {
  chainId: SupportedChainId;
  address: Address | "NATIVE";
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  coingeckoId?: string;
  binanceSymbol?: string;
  isCustom?: boolean;
}

export interface TokenBalance extends TokenAsset {
  rawBalance: bigint;
  formattedBalance: string;
  usdPrice: number;
  priceChange24h: number;
  usdValue: number;
}

export type TxStatus = "pending" | "confirmed" | "failed" | "replaced" | "cancelled";

export interface WalletTransaction {
  hash: Hex;
  chainId: SupportedChainId;
  from: Address;
  to: Address;
  value: string; // wei string
  data: Hex;
  nonce: number;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  gasLimit: string;
  type: "send" | "swap" | "approve" | "cancel" | "bridge";
  summary: string;
  status: TxStatus;
  timestamp: number;
  explorerUrl: string;
}

export interface AddressBookEntry {
  address: Address;
  label: string;
  lastUsed?: number;
}

export interface SwapQuoteResponse {
  chainId: SupportedChainId;
  sellToken: Address | "NATIVE";
  buyToken: Address | "NATIVE";
  sellAmount: string;
  buyAmount: string;
  estimatedPriceImpact: string;
  price: string;
  guaranteedPrice: string;
  to: Address;
  data: Hex;
  value: string;
  gas: string;
  allowanceTarget: Address;
  sources: Array<{ name: string; proportion: string }>;
}

export interface SecurityAuditResult {
  isSafe: boolean;
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  isOpenSource: boolean;
  isProxy: boolean;
  warnings: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}
