import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Address, Hex } from "viem";
import {
  AddressBookEntry,
  EncryptedKeystore,
  SupportedChainId,
  TokenAsset,
  WalletTransaction,
} from "@/types/wallet";
import { DEFAULT_TOKENS } from "@/lib/chains/config";

interface WalletState {
  keystore: EncryptedKeystore | null;
  activeAddress: Address | null;
  connectionMode: "internal" | "external" | null;
  isUnlocked: boolean;
  sessionPrivateKey: Hex | null; // Strictly volatile, excluded from localStorage
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
      customTokens: DEFAULT_TOKENS,
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
          return { customTokens: [...state.customTokens, token] };
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

      updateTransactionStatus: (hash, status) =>
        set((state) => ({
          transactions: state.transactions.map((t) =>
            t.hash.toLowerCase() === hash.toLowerCase() ? { ...t, status } : t
          ),
        })),

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
          biometricCredentialId: null,
        }),
    }),
    {
      name: "aethervault-storage-v1",
      // CRITICAL SECURITY: Never persist `sessionPrivateKey` or `isUnlocked` to disk
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
        currency: state.currency,
        theme: state.theme,
      }),
    }
  )
);
