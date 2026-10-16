import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Address, Hex, parseAbi } from "viem";
import {
  AddressBookEntry,
  EncryptedKeystore,
  SupportedChainId,
  TokenAsset,
  WalletTransaction,
} from "@/types/wallet";
import { DEFAULT_TOKENS, getResilientPublicClient } from "@/lib/chains/config";
import { EXPANDED_CATALOG } from "@/lib/tokens/registry";

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export function getTokenBalanceKey(
  chainId: SupportedChainId,
  addressOrNative: string
): string {
  return `${chainId}:${addressOrNative.toLowerCase()}`;
}

interface WalletState {
  keystore: EncryptedKeystore | null;
  activeAddress: Address | null;
  connectionMode: "internal" | "external" | null;
  isUnlocked: boolean;
  sessionPrivateKey: Hex | null;
  lastActiveTimestamp: number;
  autoLockMinutes: number;
  biometricCredentialId: string | null;

  activeChainId: SupportedChainId;
  customRpcs: Partial<Record<SupportedChainId, string>>;
  customTokens: TokenAsset[];
  addressBook: AddressBookEntry[];
  knownRecipients: Address[];
  transactions: WalletTransaction[];
  currency: "USD" | "EUR" | "GBP";
  theme: "dark" | "light";

  // Global Synchronized Balance Ledger (persisted so swaps & transfers reflect immediately)
  onChainBalances: Record<string, string>; // key -> raw wei string
  swapLedgerDeltas: Record<string, string>; // key -> signed wei delta string from settled swaps
  balanceSyncVersion: number;

  // Actions
  setVaultInitialized: (
    keystore: EncryptedKeystore,
    sessionPrivateKey: Hex
  ) => void;
  setExternalConnected: (address: Address) => void;
  unlockWithSessionKey: (sessionPrivateKey: Hex) => void;
  lockWallet: () => void;
  touchActivity: () => void;
  setActiveChainId: (chainId: SupportedChainId) => void;
  setCustomRpc: (chainId: SupportedChainId, url: string) => void;
  addCustomToken: (token: TokenAsset) => void;
  addAddressBookEntry: (entry: AddressBookEntry) => void;
  markRecipientKnown: (address: Address) => void;
  addTransaction: (tx: WalletTransaction) => void;
  updateTransactionStatus: (
    hash: Hex,
    status: WalletTransaction["status"],
    replacementHash?: Hex
  ) => void;

  // Global Balance & Swap Reflection Actions
  syncChainBalances: (chainId?: SupportedChainId) => Promise<void>;
  applySwapBalanceDelta: (params: {
    chainId: SupportedChainId;
    sellToken: TokenAsset;
    buyToken: TokenAsset;
    sellAmountWei: bigint;
    buyAmountWei: bigint;
    isSimulatedRouterCalldata: boolean;
  }) => void;
  getEffectiveTokenBalance: (
    chainId: SupportedChainId,
    token: TokenAsset
  ) => bigint;

  setAutoLockMinutes: (minutes: number) => void;
  setBiometricCredentialId: (id: string | null) => void;
  setTheme: (theme: "dark" | "light") => void;
  setCurrency: (currency: "USD" | "EUR" | "GBP") => void;
  resetWallet: () => void;
}

const DEFAULT_CHAIN: SupportedChainId =
  process.env.NEXT_PUBLIC_DEV_TESTNET_DEFAULT === "false" ? 1 : 11155111;

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      keystore: null,
      activeAddress: null,
      connectionMode: null,
      isUnlocked: false,
      sessionPrivateKey: null,
      lastActiveTimestamp: Date.now(),
      autoLockMinutes: 5,
      biometricCredentialId: null,

      activeChainId: DEFAULT_CHAIN,
      customRpcs: {},
      customTokens: EXPANDED_CATALOG.length > 0 ? EXPANDED_CATALOG : DEFAULT_TOKENS,
      addressBook: [
        {
          address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          label: "vitalik.eth (Demo Contact)",
        },
      ],
      knownRecipients: [],
      transactions: [],
      currency: "USD",
      theme: "dark",

      onChainBalances: {},
      swapLedgerDeltas: {},
      balanceSyncVersion: 0,

      setVaultInitialized: (keystore, sessionPrivateKey) =>
        set({
          keystore,
          activeAddress: keystore.address,
          connectionMode: "internal",
          isUnlocked: true,
          sessionPrivateKey,
          lastActiveTimestamp: Date.now(),
        }),

      setExternalConnected: (address) =>
        set({
          activeAddress: address,
          connectionMode: "external",
          isUnlocked: true,
          lastActiveTimestamp: Date.now(),
        }),

      unlockWithSessionKey: (sessionPrivateKey) =>
        set({
          isUnlocked: true,
          sessionPrivateKey,
          lastActiveTimestamp: Date.now(),
        }),

      lockWallet: () =>
        set({
          isUnlocked: false,
          sessionPrivateKey: null,
        }),

      touchActivity: () => set({ lastActiveTimestamp: Date.now() }),

      setActiveChainId: (chainId) => set({ activeChainId: chainId }),

      setCustomRpc: (chainId, url) =>
        set((state) => ({
          customRpcs: { ...state.customRpcs, [chainId]: url },
        })),

      addCustomToken: (token) =>
        set((state) => {
          const exists = state.customTokens.some(
            (t) =>
              t.chainId === token.chainId &&
              t.address.toLowerCase() === token.address.toLowerCase()
          );
          if (exists) return state;
          return { customTokens: [token, ...state.customTokens] };
        }),

      addAddressBookEntry: (entry) =>
        set((state) => ({
          addressBook: [
            ...state.addressBook.filter(
              (e) => e.address.toLowerCase() !== entry.address.toLowerCase()
            ),
            entry,
          ],
        })),

      markRecipientKnown: (address) =>
        set((state) => ({
          knownRecipients: Array.from(
            new Set([...state.knownRecipients, address.toLowerCase() as Address])
          ),
        })),

      addTransaction: (tx) =>
        set((state) => ({
          transactions: [tx, ...state.transactions],
        })),

      updateTransactionStatus: (hash, status, replacementHash) =>
        set((state) => ({
          transactions: state.transactions.map((t) =>
            t.hash.toLowerCase() === hash.toLowerCase()
              ? {
                  ...t,
                  status,
                  ...(replacementHash ? { hash: replacementHash } : {}),
                }
              : t
          ),
        })),

      /**
       * Pulls live on-chain balances for all tokens on the active network
       * and merges them into the global Zustand balance store.
       */
      syncChainBalances: async (targetChainId) => {
        const state = get();
        const chainId = targetChainId ?? state.activeChainId;
        const owner = state.activeAddress;
        if (!owner) return;

        const client = getResilientPublicClient(
          chainId,
          state.customRpcs[chainId]
        );
        const chainTokens = state.customTokens.filter(
          (t) => t.chainId === chainId
        );

        const updated: Record<string, string> = {};

        await Promise.all(
          chainTokens.map(async (token) => {
            const key = getTokenBalanceKey(chainId, token.address);
            try {
              if (token.address === "NATIVE") {
                const bal = await client.getBalance({ address: owner });
                updated[key] = bal.toString();
              } else {
                const bal = await client.readContract({
                  address: token.address,
                  abi: ERC20_BALANCE_ABI,
                  functionName: "balanceOf",
                  args: [owner],
                });
                updated[key] = bal.toString();
              }
            } catch {
              // Retain existing cached balance if a single RPC call times out
            }
          })
        );

        set((prev) => ({
          onChainBalances: { ...prev.onChainBalances, ...updated },
          balanceSyncVersion: prev.balanceSyncVersion + 1,
        }));
      },

      /**
       * Immediately updates the user's token balances when a Swap is executed,
       * and ensures both the sold and bought tokens are visible in `customTokens`.
       */
      applySwapBalanceDelta: ({
        chainId,
        sellToken,
        buyToken,
        sellAmountWei,
        buyAmountWei,
        isSimulatedRouterCalldata,
      }) => {
        set((state) => {
          const sellKey = getTokenBalanceKey(chainId, sellToken.address);
          const buyKey = getTokenBalanceKey(chainId, buyToken.address);

          // Ensure both tokens exist in customTokens so the bought token appears on Dashboard
          const updatedTokens = [...state.customTokens];
          [sellToken, buyToken].forEach((tok) => {
            const exists = updatedTokens.some(
              (t) =>
                t.chainId === tok.chainId &&
                t.address.toLowerCase() === tok.address.toLowerCase()
            );
            if (!exists) updatedTokens.unshift(tok);
          });

          // 1. Optimistically update onChainBalances immediately for instant UI reflection
          const currentSellRaw = BigInt(state.onChainBalances[sellKey] || "0");
          const currentBuyRaw = BigInt(state.onChainBalances[buyKey] || "0");

          const nextSellRaw =
            currentSellRaw > sellAmountWei ? currentSellRaw - sellAmountWei : 0n;
          const nextBuyRaw = currentBuyRaw + buyAmountWei;

          const nextOnChain = {
            ...state.onChainBalances,
            [sellKey]: nextSellRaw.toString(),
            [buyKey]: nextBuyRaw.toString(),
          };

          // 2. If the swap used Testnet synthetic settlement (where no external DEX pool minted the ERC-20),
          // persist the swap ledger delta so subsequent RPC block polls preserve the swapped token balance!
          const nextDeltas = { ...state.swapLedgerDeltas };
          if (isSimulatedRouterCalldata) {
            // If native ETH was sent in `value`, the chain already deducts `sellAmountWei` from ETH balance,
            // so we only need a ledger delta for ERC-20 sell tokens and the bought token.
            if (sellToken.address !== "NATIVE") {
              const prevSellDelta = BigInt(nextDeltas[sellKey] || "0");
              nextDeltas[sellKey] = (prevSellDelta - sellAmountWei).toString();
            }
            const prevBuyDelta = BigInt(nextDeltas[buyKey] || "0");
            nextDeltas[buyKey] = (prevBuyDelta + buyAmountWei).toString();
          }

          return {
            customTokens: updatedTokens,
            onChainBalances: nextOnChain,
            swapLedgerDeltas: nextDeltas,
            balanceSyncVersion: state.balanceSyncVersion + 1,
          };
        });
      },

      /**
       * Returns the live on-chain balance combined with any settled Testnet swap deltas.
       */
      getEffectiveTokenBalance: (chainId, token) => {
        const state = get();
        const key = getTokenBalanceKey(chainId, token.address);
        const rawChain = BigInt(state.onChainBalances[key] || "0");
        const delta = BigInt(state.swapLedgerDeltas[key] || "0");
        const combined = rawChain + delta;
        return combined > 0n ? combined : 0n;
      },

      setAutoLockMinutes: (minutes) => set({ autoLockMinutes: minutes }),
      setBiometricCredentialId: (id) => set({ biometricCredentialId: id }),
      setTheme: (theme) => set({ theme }),
      setCurrency: (currency) => set({ currency }),

      resetWallet: () =>
        set({
          keystore: null,
          activeAddress: null,
          connectionMode: null,
          isUnlocked: false,
          sessionPrivateKey: null,
          transactions: [],
          knownRecipients: [],
          onChainBalances: {},
          swapLedgerDeltas: {},
          biometricCredentialId: null,
        }),
    }),
    {
      name: "aethervault-storage-v1",
      partialize: (state) => ({
        keystore: state.keystore,
        activeAddress: state.activeAddress,
        connectionMode: state.connectionMode,
        autoLockMinutes: state.autoLockMinutes,
        biometricCredentialId: state.biometricCredentialId,
        activeChainId: state.activeChainId,
        customRpcs: state.customRpcs,
        customTokens: state.customTokens,
        addressBook: state.addressBook,
        knownRecipients: state.knownRecipients,
        transactions: state.transactions,
        onChainBalances: state.onChainBalances,
        swapLedgerDeltas: state.swapLedgerDeltas,
        currency: state.currency,
        theme: state.theme,
      }),
    }
  )
);
