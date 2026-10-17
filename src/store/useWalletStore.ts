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

interface PendingSwapLock {
  chainId: SupportedChainId;
  sellKey: string;
  buyKey: string;
  sellAmountWei: string;
  buyAmountWei: string;
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

  // Strictly separated Raw RPC Balances vs Synthetic Ledger Deltas vs In-Flight Locks
  onChainBalances: Record<string, string>;
  swapLedgerDeltas: Record<string, string>;
  pendingSwapLocks: Record<string, PendingSwapLock>; // txHash -> lock
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

  // Exact Swap Accounting Actions
  syncChainBalances: (chainId?: SupportedChainId) => Promise<void>;
  recordSwapExecution: (params: {
    txHash: Hex;
    chainId: SupportedChainId;
    sellToken: TokenAsset;
    buyToken: TokenAsset;
    sellAmountWei: bigint;
    buyAmountWei: bigint;
    isSimulatedRouterCalldata: boolean;
  }) => void;
  finalizeSwapReceipt: (txHash: Hex, succeeded: boolean) => void;
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
      pendingSwapLocks: {},
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
       * Pulls strictly the raw on-chain balances from the RPC.
       * Never mixes optimistic deltas into `onChainBalances`, preventing double-counting!
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
              // Keep last known on-chain value on transient RPC timeout
            }
          })
        );

        set((prev) => ({
          onChainBalances: { ...prev.onChainBalances, ...updated },
          balanceSyncVersion: prev.balanceSyncVersion + 1,
        }));
      },

      /**
       * Records a swap WITHOUT ever double-counting:
       * - If `isSimulatedRouterCalldata` is true (Sepolia synthetic swap), the on-chain tx sends `0` value
       *   (only burning gas), so we permanently record `-sellAmountWei` on `sellKey` and `+buyAmountWei` on `buyKey`
       *   inside `swapLedgerDeltas`.
       * - If `isSimulatedRouterCalldata` is false (real WETH wrap or Mainnet LI.FI/0x swap), we store a temporary
       *   `pendingSwapLock` that is automatically removed the moment the block receipt confirms on-chain.
       */
      recordSwapExecution: ({
        txHash,
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

          const updatedTokens = [...state.customTokens];
          [sellToken, buyToken].forEach((tok) => {
            const exists = updatedTokens.some(
              (t) =>
                t.chainId === tok.chainId &&
                t.address.toLowerCase() === tok.address.toLowerCase()
            );
            if (!exists) updatedTokens.unshift(tok);
          });

          if (isSimulatedRouterCalldata) {
            const nextDeltas = { ...state.swapLedgerDeltas };
            const prevSellDelta = BigInt(nextDeltas[sellKey] || "0");
            const prevBuyDelta = BigInt(nextDeltas[buyKey] || "0");

            nextDeltas[sellKey] = (prevSellDelta - sellAmountWei).toString();
            nextDeltas[buyKey] = (prevBuyDelta + buyAmountWei).toString();

            return {
              customTokens: updatedTokens,
              swapLedgerDeltas: nextDeltas,
              balanceSyncVersion: state.balanceSyncVersion + 1,
            };
          } else {
            return {
              customTokens: updatedTokens,
              pendingSwapLocks: {
                ...state.pendingSwapLocks,
                [txHash.toLowerCase()]: {
                  chainId,
                  sellKey,
                  buyKey,
                  sellAmountWei: sellAmountWei.toString(),
                  buyAmountWei: buyAmountWei.toString(),
                },
              },
              balanceSyncVersion: state.balanceSyncVersion + 1,
            };
          }
        });
      },

      /**
       * Clears the temporary pending lock once a real router swap is mined on-chain
       * so the newly fetched RPC balance takes over seamlessly.
       */
      finalizeSwapReceipt: (txHash, _succeeded) => {
        set((state) => {
          const nextLocks = { ...state.pendingSwapLocks };
          delete nextLocks[txHash.toLowerCase()];
          return {
            pendingSwapLocks: nextLocks,
            balanceSyncVersion: state.balanceSyncVersion + 1,
          };
        });
      },

      /**
       * Computes the exact balance for any token:
       * `rawOnChainBalance + permanentSyntheticDelta + activePendingSwapLocks`
       */
      getEffectiveTokenBalance: (chainId, token) => {
        const state = get();
        const key = getTokenBalanceKey(chainId, token.address);
        const rawChain = BigInt(state.onChainBalances[key] || "0");
        const permanentDelta = BigInt(state.swapLedgerDeltas[key] || "0");

        let pendingDelta = 0n;
        Object.values(state.pendingSwapLocks).forEach((lock) => {
          if (lock.chainId !== chainId) return;
          if (lock.sellKey === key) {
            pendingDelta -= BigInt(lock.sellAmountWei);
          }
          if (lock.buyKey === key) {
            pendingDelta += BigInt(lock.buyAmountWei);
          }
        });

        const total = rawChain + permanentDelta + pendingDelta;
        return total > 0n ? total : 0n;
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
          pendingSwapLocks: {},
          biometricCredentialId: null,
        }),
    }),
    {
      name: "aethervault-storage-v2", // Bumped storage key to clear any corrupted v1 double-counted deltas
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
