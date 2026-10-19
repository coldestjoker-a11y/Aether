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
import {
  DEFAULT_TOKENS,
  getResilientPublicClient,
  SUPPORTED_CHAINS,
} from "@/lib/chains/config";
import { EXPANDED_CATALOG } from "@/lib/tokens/registry";
import {
  deriveAssetVaultAccount,
  readIncomingTransferPackets,
} from "@/lib/crypto/assetAddresses";

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
  processedIncomingHashes: string[];
  currency: "USD" | "EUR" | "GBP";
  theme: "dark" | "light";

  onChainBalances: Record<string, string>;
  swapLedgerDeltas: Record<string, string>;
  pendingSwapLocks: Record<string, PendingSwapLock>;
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

  // Per-Asset Address & Global Balance Engine
  getTokenVaultAddress: (token: TokenAsset) => Address;
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
  recordSendExecution: (params: {
    chainId: SupportedChainId;
    token: TokenAsset;
    amountWei: bigint;
    usedSyntheticSettlement: boolean;
  }) => void;
  finalizeSwapReceipt: (txHash: Hex, succeeded: boolean) => void;
  getEffectiveTokenBalance: (
    chainId: SupportedChainId,
    token: TokenAsset
  ) => bigint;
  getRawOnChainTokenBalance: (
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
      customTokens:
        EXPANDED_CATALOG.length > 0 ? EXPANDED_CATALOG : DEFAULT_TOKENS,
      addressBook: [
        {
          address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          label: "vitalik.eth (Demo Contact)",
        },
      ],
      knownRecipients: [],
      transactions: [],
      processedIncomingHashes: [],
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
            new Set([
              ...state.knownRecipients,
              address.toLowerCase() as Address,
            ])
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
       * Returns the dedicated receiving/sending Vault Address for any specific token pair!
       */
      getTokenVaultAddress: (token) => {
        const state = get();
        if (!state.activeAddress) {
          return "0x0000000000000000000000000000000000000000" as Address;
        }
        return deriveAssetVaultAccount({
          masterAddress: state.activeAddress,
          sessionPrivateKey: state.sessionPrivateKey,
          token,
        }).vaultAddress;
      },

      /**
       * Queries BOTH the user's Master Wallet Address AND each token's dedicated Sub-Vault Address
       * so any deposit sent to either address lands cleanly in the wallet!
       * Also processes incoming transfer packets from `BroadcastChannel` / `localStorage`.
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

        // Build map of all valid addresses belonging to this user (Master + Per-Token Vaults)
        const ownedAddresses = new Set<string>([owner.toLowerCase()]);
        const tokenVaultMap = new Map<string, Address>();

        chainTokens.forEach((token) => {
          const { vaultAddress } = deriveAssetVaultAccount({
            masterAddress: owner,
            sessionPrivateKey: state.sessionPrivateKey,
            token,
          });
          ownedAddresses.add(vaultAddress.toLowerCase());
          tokenVaultMap.set(
            getTokenBalanceKey(chainId, token.address),
            vaultAddress
          );
        });

        // 1. Reconcile any incoming transfer packets sent to the user's Master OR Pair Vault Address
        const inboxPackets = readIncomingTransferPackets();
        const newProcessed = [...state.processedIncomingHashes];
        const nextDeltas = { ...state.swapLedgerDeltas };
        const newIncomingTxs: WalletTransaction[] = [];

        const explorerBase =
          SUPPORTED_CHAINS[chainId].blockExplorers?.default.url ||
          "https://sepolia.etherscan.io";

        inboxPackets.forEach((pkt) => {
          if (pkt.chainId !== chainId) return;
          const lowerHash = pkt.txHash.toLowerCase();
          if (newProcessed.includes(lowerHash)) return;

          const isForMe = ownedAddresses.has(pkt.to.toLowerCase());
          const isFromMe = ownedAddresses.has(pkt.from.toLowerCase());

          // If received from an external wallet OR sent specifically to one of our pair sub-vaults
          if (isForMe && (!isFromMe || pkt.to.toLowerCase() !== pkt.from.toLowerCase())) {
            const matchedToken = chainTokens.find(
              (t) =>
                t.symbol.toUpperCase() === pkt.symbol.toUpperCase() ||
                t.address.toLowerCase() === pkt.tokenAddress.toLowerCase()
            );
            if (matchedToken) {
              const key = getTokenBalanceKey(chainId, matchedToken.address);
              const prevDelta = BigInt(nextDeltas[key] || "0");
              nextDeltas[key] = (prevDelta + BigInt(pkt.amountWei)).toString();
              newProcessed.push(lowerHash);

              if (
                !state.transactions.some(
                  (tx) => tx.hash.toLowerCase() === lowerHash
                )
              ) {
                newIncomingTxs.push({
                  hash: pkt.txHash,
                  chainId,
                  from: pkt.from,
                  to: pkt.to,
                  value: pkt.amountWei,
                  data: "0x",
                  nonce: 0,
                  maxFeePerGas: "0",
                  maxPriorityFeePerGas: "0",
                  gasLimit: "65000",
                  type: "send",
                  summary: `[INCOMING] Received ${pkt.symbol} Deposit`,
                  status: "confirmed",
                  timestamp: pkt.timestamp,
                  explorerUrl: `${explorerBase}/tx/${pkt.txHash}`,
                });
              }
            }
          }
        });

        // 2. Query live on-chain balances across BOTH Master Address + Pair Vault Address
        const updated: Record<string, string> = {};

        await Promise.all(
          chainTokens.map(async (token) => {
            const key = getTokenBalanceKey(chainId, token.address);
            const pairVault = tokenVaultMap.get(key) || owner;
            try {
              if (token.address === "NATIVE") {
                const [balMaster, balVault] = await Promise.all([
                  client.getBalance({ address: owner }),
                  pairVault.toLowerCase() !== owner.toLowerCase()
                    ? client.getBalance({ address: pairVault })
                    : Promise.resolve(0n),
                ]);
                updated[key] = (balMaster + balVault).toString();
              } else {
                const [balMaster, balVault] = await Promise.all([
                  client.readContract({
                    address: token.address,
                    abi: ERC20_BALANCE_ABI,
                    functionName: "balanceOf",
                    args: [owner],
                  }),
                  pairVault.toLowerCase() !== owner.toLowerCase()
                    ? client.readContract({
                        address: token.address,
                        abi: ERC20_BALANCE_ABI,
                        functionName: "balanceOf",
                        args: [pairVault],
                      })
                    : Promise.resolve(0n),
                ]);
                updated[key] = (balMaster + balVault).toString();
              }
            } catch {
              // Keep cached balance if RPC times out
            }
          })
        );

        set((prev) => ({
          onChainBalances: { ...prev.onChainBalances, ...updated },
          swapLedgerDeltas: nextDeltas,
          processedIncomingHashes: newProcessed,
          transactions: [...newIncomingTxs, ...prev.transactions],
          balanceSyncVersion: prev.balanceSyncVersion + 1,
        }));
      },

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

      recordSendExecution: ({
        chainId,
        token,
        amountWei,
        usedSyntheticSettlement,
      }) => {
        set((state) => {
          const key = getTokenBalanceKey(chainId, token.address);

          if (usedSyntheticSettlement) {
            const nextDeltas = { ...state.swapLedgerDeltas };
            const prevDelta = BigInt(nextDeltas[key] || "0");
            nextDeltas[key] = (prevDelta - amountWei).toString();
            return {
              swapLedgerDeltas: nextDeltas,
              balanceSyncVersion: state.balanceSyncVersion + 1,
            };
          }

          const prevRaw = BigInt(state.onChainBalances[key] || "0");
          const nextRaw = prevRaw > amountWei ? prevRaw - amountWei : 0n;
          return {
            onChainBalances: {
              ...state.onChainBalances,
              [key]: nextRaw.toString(),
            },
            balanceSyncVersion: state.balanceSyncVersion + 1,
          };
        });
      },

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

      getRawOnChainTokenBalance: (chainId, token) => {
        const state = get();
        const key = getTokenBalanceKey(chainId, token.address);
        return BigInt(state.onChainBalances[key] || "0");
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
          processedIncomingHashes: [],
          onChainBalances: {},
          swapLedgerDeltas: {},
          pendingSwapLocks: {},
          biometricCredentialId: null,
        }),
    }),
    {
      name: "aethervault-storage-v3",
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
        processedIncomingHashes: state.processedIncomingHashes,
        onChainBalances: state.onChainBalances,
        swapLedgerDeltas: state.swapLedgerDeltas,
        currency: state.currency,
        theme: state.theme,
      }),
    }
  )
);
