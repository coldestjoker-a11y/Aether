import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Address, formatUnits, Hex, parseAbi } from "viem";
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

let lastRpcSyncTimestamp = 0;
let isSyncInFlight = false;

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
  theme: "dark" | "light" | "aether";

  onChainBalances: Record<string, string>;
  swapLedgerDeltas: Record<string, string>;
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
    status: WalletTransaction["status"]
  ) => void;

  // Synchronized Balance & Activity Actions
  getTokenVaultAddress: (token: TokenAsset) => Address;
  startRealtimeOnChainSubscription: (chainId?: SupportedChainId) => () => void;
  syncChainBalances: (
    chainId?: SupportedChainId,
    force?: boolean
  ) => Promise<void>;
  processInstantInboxAndBlockPayloads: (
    chainId: SupportedChainId
  ) => Promise<void>;
  commitConfirmedSwap: (params: {
    txHash: Hex;
    chainId: SupportedChainId;
    sellToken: TokenAsset;
    buyToken: TokenAsset;
    sellAmountWei: bigint;
    buyAmountWei: bigint;
  }) => void;
  commitConfirmedSend: (params: {
    txHash: Hex;
    chainId: SupportedChainId;
    token: TokenAsset;
    amountWei: bigint;
    usedSyntheticSettlement: boolean;
  }) => void;
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
  setTheme: (theme: "dark" | "light" | "aether") => void;
  setCurrency: (currency: "USD" | "EUR" | "GBP") => void;
  resetWallet: () => void;
}

const DEFAULT_CHAIN: SupportedChainId =
  process.env.NEXT_PUBLIC_DEV_TESTNET_DEFAULT === "true" ? 11155111 : 1;

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
          label: "vitalik.eth",
        },
      ],
      knownRecipients: [],
      transactions: [],
      processedIncomingHashes: [],
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

      // Throttled activity update: only writes to store if > 30s elapsed (0 lag on clicks!)
      touchActivity: () => {
        const now = Date.now();
        if (now - get().lastActiveTimestamp > 30_000) {
          set({ lastActiveTimestamp: now });
        }
      },

      setActiveChainId: (chainId) => {
        lastRpcSyncTimestamp = 0;
        set({ activeChainId: chainId });
      },

      setCustomRpc: (chainId, url) =>
        set((state) => ({
          customRpcs: { ...state.customRpcs, [chainId]: url },
        })),

      addCustomToken: (token) =>
        set((state) => {
          const exists = state.customTokens.some(
            (t) =>
              t.chainId === token.chainId &&
              t.symbol.toUpperCase() === token.symbol.toUpperCase()
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
        set((state) => {
          const lower = address.toLowerCase() as Address;
          if (state.knownRecipients.includes(lower)) return state;
          return { knownRecipients: [...state.knownRecipients, lower] };
        }),

      addTransaction: (tx) =>
        set((state) => ({
          transactions: [
            tx,
            ...state.transactions.filter(
              (t) => t.hash.toLowerCase() !== tx.hash.toLowerCase()
            ),
          ].slice(0, 80),
        })),

      updateTransactionStatus: (hash, status) =>
        set((state) => ({
          transactions: state.transactions.map((t) =>
            t.hash.toLowerCase() === hash.toLowerCase() ? { ...t, status } : t
          ),
        })),

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

      startRealtimeOnChainSubscription: (targetChainId) => {
        const chainId = targetChainId ?? get().activeChainId;
        get().syncChainBalances(chainId);
        return () => {};
      },

      processInstantInboxAndBlockPayloads: async (chainId) => {
        const state = get();
        const owner = state.activeAddress;
        if (!owner) return;

        const chainTokens = state.customTokens.filter(
          (t) => t.chainId === chainId
        );

        const ownedAddresses = new Set<string>([owner.toLowerCase()]);
        chainTokens.forEach((token) => {
          const { vaultAddress, legacySubVaultAddress } =
            deriveAssetVaultAccount({
              masterAddress: owner,
              sessionPrivateKey: state.sessionPrivateKey,
              token,
            });
          ownedAddresses.add(vaultAddress.toLowerCase());
          if (legacySubVaultAddress) {
            ownedAddresses.add(legacySubVaultAddress.toLowerCase());
          }
        });

        const inboxPackets = readIncomingTransferPackets();
        if (inboxPackets.length === 0) return;

        const newProcessed = [...state.processedIncomingHashes];
        const nextDeltas = { ...state.swapLedgerDeltas };
        const newIncomingTxs: WalletTransaction[] = [];
        let changed = false;

        const explorerBase =
          SUPPORTED_CHAINS[chainId].blockExplorers?.default.url ||
          "https://bscscan.com";

        inboxPackets.forEach((pkt) => {
          if (pkt.chainId !== chainId) return;
          const lowerHash = pkt.txHash.toLowerCase();
          if (newProcessed.includes(lowerHash)) return;

          const isRecipientMe = ownedAddresses.has(pkt.to.toLowerCase());
          const isSenderMe = ownedAddresses.has(pkt.from.toLowerCase());

          if (isRecipientMe) {
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
              changed = true;

              if (!isSenderMe) {
                const humanAmt = parseFloat(
                  formatUnits(BigInt(pkt.amountWei), matchedToken.decimals)
                ).toFixed(4);
                newIncomingTxs.push({
                  hash: pkt.txHash,
                  chainId,
                  from: pkt.from,
                  to: pkt.to,
                  value: pkt.amountWei,
                  data: "0x",
                  nonce: 0,
                  maxFeePerGas: "50000000",
                  maxPriorityFeePerGas: "50000000",
                  gasLimit: "55000",
                  type: "send",
                  summary: `[INCOMING] Received ${humanAmt} ${matchedToken.symbol}`,
                  status: "confirmed",
                  timestamp: pkt.timestamp,
                  explorerUrl: `${explorerBase}/tx/${pkt.txHash}`,
                });
              }
            }
          }
        });

        if (changed) {
          set((prev) => ({
            swapLedgerDeltas: nextDeltas,
            processedIncomingHashes: newProcessed.slice(-150),
            transactions: [...newIncomingTxs, ...prev.transactions].slice(0, 80),
            balanceSyncVersion: prev.balanceSyncVersion + 1,
          }));
        }
      },

      /**
       * ULTRA-STABLE MULTICALL SYNC:
       * Only triggers a Zustand state update if at least one token balance actually changed on-chain.
       * Eliminates unnecessary re-renders and localStorage writes when polling idle blocks!
       */
      syncChainBalances: async (targetChainId, force = false) => {
        const state = get();
        const chainId = targetChainId ?? state.activeChainId;
        const owner = state.activeAddress;
        if (!owner) return;

        await get().processInstantInboxAndBlockPayloads(chainId);

        const now = Date.now();
        if (!force && (isSyncInFlight || now - lastRpcSyncTimestamp < 8000)) {
          return;
        }

        isSyncInFlight = true;
        lastRpcSyncTimestamp = now;

        try {
          const client = getResilientPublicClient(
            chainId,
            state.customRpcs[chainId]
          );

          const chainTokens = state.customTokens.filter(
            (t) => t.chainId === chainId
          );

          const updated: Record<string, string> = {};
          const detectedDepositTxs: WalletTransaction[] = [];
          let anyBalanceChanged = false;

          const explorerBase =
            SUPPORTED_CHAINS[chainId].blockExplorers?.default.url ||
            "https://bscscan.com";

          // 1. Native Balance
          const nativeToken = chainTokens.find((t) => t.address === "NATIVE");
          if (nativeToken) {
            const natBal = await client
              .getBalance({ address: owner })
              .catch(() => null);
            if (natBal !== null) {
              const key = getTokenBalanceKey(chainId, "NATIVE");
              const prevRawStr = state.onChainBalances[key];
              const nextRawStr = natBal.toString();

              if (prevRawStr !== nextRawStr) {
                anyBalanceChanged = true;
                const prevRaw = BigInt(prevRawStr || "0");
                if (natBal > prevRaw && prevRawStr !== undefined) {
                  const diff = natBal - prevRaw;
                  const humanDiff = parseFloat(
                    formatUnits(diff, nativeToken.decimals)
                  ).toFixed(4);
                  const depositId =
                    `0xdep${chainId}${nativeToken.symbol}${natBal.toString().slice(0, 12)}`.padEnd(
                      66,
                      "0"
                    ) as Hex;
                  if (
                    !state.transactions.some(
                      (t) => t.hash.toLowerCase() === depositId.toLowerCase()
                    )
                  ) {
                    detectedDepositTxs.push({
                      hash: depositId,
                      chainId,
                      from: "0x0000000000000000000000000000000000DE9051" as Address,
                      to: owner,
                      value: diff.toString(),
                      data: "0x",
                      nonce: 0,
                      maxFeePerGas: "50000000",
                      maxPriorityFeePerGas: "50000000",
                      gasLimit: "21000",
                      type: "send",
                      summary: `[INCOMING] Received ${humanDiff} ${nativeToken.symbol}`,
                      status: "confirmed",
                      timestamp: Date.now(),
                      explorerUrl: `${explorerBase}/address/${owner}`,
                    });
                  }
                }
              }
              updated[key] = nextRawStr;
            }
          }

          // 2. ERC-20 Multicall
          const erc20Tokens = chainTokens.filter((t) => t.address !== "NATIVE");
          if (erc20Tokens.length > 0) {
            const contracts = erc20Tokens.flatMap((token) => {
              const { legacySubVaultAddress } = deriveAssetVaultAccount({
                masterAddress: owner,
                sessionPrivateKey: state.sessionPrivateKey,
                token,
              });

              return [
                {
                  address: token.address as Address,
                  abi: ERC20_BALANCE_ABI,
                  functionName: "balanceOf" as const,
                  args: [owner] as const,
                },
                {
                  address: token.address as Address,
                  abi: ERC20_BALANCE_ABI,
                  functionName: "balanceOf" as const,
                  args: [legacySubVaultAddress || owner] as const,
                },
              ];
            });

            try {
              const results = await client.multicall({
                contracts,
                allowFailure: true,
              });

              erc20Tokens.forEach((token, idx) => {
                const key = getTokenBalanceKey(chainId, token.address);
                const { legacySubVaultAddress } = deriveAssetVaultAccount({
                  masterAddress: owner,
                  sessionPrivateKey: state.sessionPrivateKey,
                  token,
                });

                const masterRes = results[idx * 2];
                const legacyRes = results[idx * 2 + 1];

                const balMaster =
                  masterRes?.status === "success"
                    ? (masterRes.result as bigint)
                    : 0n;
                const balLegacy =
                  legacySubVaultAddress &&
                  legacySubVaultAddress.toLowerCase() !== owner.toLowerCase() &&
                  legacyRes?.status === "success"
                    ? (legacyRes.result as bigint)
                    : 0n;

                const totalChainBal = balMaster + balLegacy;
                const prevRawStr = state.onChainBalances[key];
                const nextRawStr = totalChainBal.toString();

                if (prevRawStr !== nextRawStr) {
                  anyBalanceChanged = true;
                  const prevRaw = BigInt(prevRawStr || "0");
                  if (totalChainBal > prevRaw) {
                    const diff = totalChainBal - prevRaw;
                    const humanDiff = parseFloat(
                      formatUnits(diff, token.decimals)
                    ).toFixed(4);
                    const depositHash =
                      `0xerc20dep${chainId}${token.symbol}${totalChainBal.toString().slice(0, 10)}`.padEnd(
                        66,
                        "0"
                      ) as Hex;
                    if (
                      !state.transactions.some(
                        (t) =>
                          t.hash.toLowerCase() === depositHash.toLowerCase()
                      )
                    ) {
                      detectedDepositTxs.push({
                        hash: depositHash,
                        chainId,
                        from: token.address as Address,
                        to: owner,
                        value: diff.toString(),
                        data: "0x",
                        nonce: 0,
                        maxFeePerGas: "50000000",
                        maxPriorityFeePerGas: "50000000",
                        gasLimit: "55000",
                        type: "send",
                        summary: `[INCOMING] Received ${humanDiff} ${token.symbol}`,
                        status: "confirmed",
                        timestamp: Date.now(),
                        explorerUrl: `${explorerBase}/token/${token.address}?a=${owner}`,
                      });
                    }
                  }
                }

                updated[key] = nextRawStr;
              });
            } catch {
              // Ignore transient multicall timeout
            }
          }

          if (anyBalanceChanged || detectedDepositTxs.length > 0 || force) {
            set((prev) => ({
              onChainBalances: { ...prev.onChainBalances, ...updated },
              transactions:
                detectedDepositTxs.length > 0
                  ? [...detectedDepositTxs, ...prev.transactions].slice(0, 80)
                  : prev.transactions,
              balanceSyncVersion: prev.balanceSyncVersion + 1,
            }));
          }
        } finally {
          isSyncInFlight = false;
        }
      },

      /**
       * Atomically marks the Swap transaction as `confirmed` in Activity AND
       * applies the balance delta at the exact same millisecond so Activity and Wallet
       * balances are 100% correlated!
       */
      commitConfirmedSwap: ({
        txHash,
        chainId,
        sellToken,
        buyToken,
        sellAmountWei,
        buyAmountWei,
      }) => {
        set((state) => {
          const sellKey = getTokenBalanceKey(chainId, sellToken.address);
          const buyKey = getTokenBalanceKey(chainId, buyToken.address);

          const updatedTokens = [...state.customTokens];
          [sellToken, buyToken].forEach((tok) => {
            const exists = updatedTokens.some(
              (t) =>
                t.chainId === tok.chainId &&
                t.symbol.toUpperCase() === tok.symbol.toUpperCase()
            );
            if (!exists) updatedTokens.unshift(tok);
          });

          const nextDeltas = { ...state.swapLedgerDeltas };
          const prevSellDelta = BigInt(nextDeltas[sellKey] || "0");
          const prevBuyDelta = BigInt(nextDeltas[buyKey] || "0");

          nextDeltas[sellKey] = (prevSellDelta - sellAmountWei).toString();
          nextDeltas[buyKey] = (prevBuyDelta + buyAmountWei).toString();

          const updatedTxs = state.transactions.map((t) =>
            t.hash.toLowerCase() === txHash.toLowerCase()
              ? { ...t, status: "confirmed" as const }
              : t
          );

          return {
            customTokens: updatedTokens,
            swapLedgerDeltas: nextDeltas,
            transactions: updatedTxs,
            balanceSyncVersion: state.balanceSyncVersion + 1,
          };
        });
      },

      /**
       * Atomically marks the Send transaction as `confirmed` in Activity AND
       * deducts the sent balance at the exact same millisecond.
       */
      commitConfirmedSend: ({
        txHash,
        chainId,
        token,
        amountWei,
        usedSyntheticSettlement,
      }) => {
        set((state) => {
          const key = getTokenBalanceKey(chainId, token.address);
          const updatedTxs = state.transactions.map((t) =>
            t.hash.toLowerCase() === txHash.toLowerCase()
              ? { ...t, status: "confirmed" as const }
              : t
          );

          if (usedSyntheticSettlement) {
            const nextDeltas = { ...state.swapLedgerDeltas };
            const prevDelta = BigInt(nextDeltas[key] || "0");
            nextDeltas[key] = (prevDelta - amountWei).toString();
            return {
              swapLedgerDeltas: nextDeltas,
              transactions: updatedTxs,
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
            transactions: updatedTxs,
            balanceSyncVersion: state.balanceSyncVersion + 1,
          };
        });
      },

      getEffectiveTokenBalance: (chainId, token) => {
        const state = get();
        const key = getTokenBalanceKey(chainId, token.address);
        const rawChain = BigInt(state.onChainBalances[key] || "0");
        const permanentDelta = BigInt(state.swapLedgerDeltas[key] || "0");
        const total = rawChain + permanentDelta;
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
          biometricCredentialId: null,
        }),
    }),
    {
      name: "aethervault-storage-v5",
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
      onRehydrateStorage: () => (state) => {
        if (state) {
          const allowedSymbols = new Set(
            EXPANDED_CATALOG.map(
              (t) => `${t.chainId}:${t.symbol.toUpperCase()}`
            )
          );
          state.customTokens = state.customTokens.filter(
            (t) =>
              t.isCustom === true ||
              allowedSymbols.has(`${t.chainId}:${t.symbol.toUpperCase()}`)
          );
        }
      },
    }
  )
);
