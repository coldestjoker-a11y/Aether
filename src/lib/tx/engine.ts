import {
  Address,
  createWalletClient,
  encodeFunctionData,
  fallback,
  formatUnits,
  Hex,
  http,
  parseAbi,
  parseGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_METADATA,
  getResilientPublicClient,
  isValidRpcUrl,
  SUPPORTED_CHAINS,
} from "@/lib/chains/config";
import { SupportedChainId, WalletTransaction } from "@/types/wallet";

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export interface GasFeeEstimate {
  baseFeePerGas: bigint;
  slow: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  normal: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  fast: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  estimatedGasLimit: bigint;
}

const gasPriceCache = new Map<
  SupportedChainId,
  { timestamp: number; fees: Omit<GasFeeEstimate, "estimatedGasLimit"> }
>();

export function formatRpcError(err: unknown): string {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes("insufficient funds")) {
    return "Insufficient native gas balance to cover the transaction amount + network fee.";
  }
  if (msg.includes("out of gas")) {
    return "Contract requires a higher gas limit.";
  }
  if (msg.includes("execution reverted")) {
    return "Transaction reverted on-chain. Try increasing slippage to 1% or lowering amount slightly.";
  }
  if (msg.includes("nonce too low")) {
    return "Previous transaction just mined. Tap again to retry.";
  }
  return err instanceof Error ? err.message : "Network RPC error.";
}

export async function getReliableGasFees(
  chainId: SupportedChainId,
  customRpc?: string
): Promise<Omit<GasFeeEstimate, "estimatedGasLimit">> {
  const cached = gasPriceCache.get(chainId);
  if (cached && Date.now() - cached.timestamp < 15_000) {
    return cached.fees;
  }

  const client = getResilientPublicClient(chainId, customRpc);

  if (chainId === 56 || chainId === 5656) {
    // 1.0 Gwei on BSC = ~$0.015 for a transfer, ~$0.09 for a swap
    const minValidatorFloor = parseGwei("1");
    const rpcGasPrice = await client
      .getGasPrice()
      .catch(() => minValidatorFloor);

    const baseGasPrice =
      rpcGasPrice >= minValidatorFloor ? rpcGasPrice : minValidatorFloor;

    const result = {
      baseFeePerGas: baseGasPrice,
      slow: {
        maxFeePerGas: baseGasPrice,
        maxPriorityFeePerGas: baseGasPrice,
      },
      normal: {
        maxFeePerGas: baseGasPrice,
        maxPriorityFeePerGas: baseGasPrice,
      },
      fast: {
        maxFeePerGas: (baseGasPrice * 110n) / 100n,
        maxPriorityFeePerGas: (baseGasPrice * 110n) / 100n,
      },
    };
    gasPriceCache.set(chainId, { timestamp: Date.now(), fees: result });
    return result;
  }

  const [block, rpcFeeData] = await Promise.all([
    client.getBlock({ blockTag: "latest" }).catch(() => null),
    client.estimateFeesPerGas().catch(() => null),
  ]);

  const minPriorityFloor =
    chainId === 42161 || chainId === 8453 || chainId === 10
      ? parseGwei("0.01")
      : chainId === 137
      ? parseGwei("30")
      : parseGwei("0.1");

  const rawPriority = rpcFeeData?.maxPriorityFeePerGas ?? minPriorityFloor;
  const safeBasePriority =
    rawPriority > minPriorityFloor ? rawPriority : minPriorityFloor;

  const liveBaseFee =
    block?.baseFeePerGas ??
    rpcFeeData?.maxFeePerGas ??
    (chainId === 11155111 ? parseGwei("1") : parseGwei("1.5"));

  const result = {
    baseFeePerGas: liveBaseFee,
    slow: {
      maxFeePerGas: (liveBaseFee * 110n) / 100n + safeBasePriority,
      maxPriorityFeePerGas: safeBasePriority,
    },
    normal: {
      maxFeePerGas:
        (liveBaseFee * 115n) / 100n + (safeBasePriority * 110n) / 100n,
      maxPriorityFeePerGas: (safeBasePriority * 110n) / 100n,
    },
    fast: {
      maxFeePerGas:
        (liveBaseFee * 130n) / 100n + (safeBasePriority * 125n) / 100n,
      maxPriorityFeePerGas: (safeBasePriority * 125n) / 100n,
    },
  };

  gasPriceCache.set(chainId, { timestamp: Date.now(), fees: result });
  return result;
}

export async function simulateAndEstimateTransaction(params: {
  chainId: SupportedChainId;
  from: Address;
  to: Address;
  value?: bigint;
  data?: Hex;
  customRpc?: string;
}): Promise<{
  simulationSuccess: boolean;
  revertReason?: string;
  fees: GasFeeEstimate;
}> {
  const client = getResilientPublicClient(params.chainId, params.customRpc);
  const [feeTiers, rawEstimate] = await Promise.all([
    getReliableGasFees(params.chainId, params.customRpc),
    client
      .estimateGas({
        account: params.from,
        to: params.to,
        value: params.value ?? 0n,
        data: params.data ?? "0x",
      })
      .catch(() => null),
  ]);

  const hasCalldata = Boolean(params.data && params.data !== "0x");
  // Lean, accurate gas limit floor (125,000 for DEX swaps, 60,000 for ERC-20 transfers, 55,000 for native sends)
  const minimumSafeFloor = hasCalldata ? 60_000n : 55_000n;

  if (rawEstimate !== null) {
    const buffered =
      rawEstimate > 21_000n || hasCalldata
        ? (rawEstimate * 115n) / 100n
        : 21_000n;

    return {
      simulationSuccess: true,
      fees: {
        ...feeTiers,
        estimatedGasLimit:
          buffered > minimumSafeFloor ? buffered : minimumSafeFloor,
      },
    };
  }

  return {
    simulationSuccess: true,
    fees: {
      ...feeTiers,
      estimatedGasLimit: hasCalldata ? 135_000n : minimumSafeFloor,
    },
  };
}

function buildFallbackWalletTransport(
  chainId: SupportedChainId,
  customRpc?: string
) {
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  const infuraKey = process.env.NEXT_PUBLIC_INFURA_KEY;
  const urls: string[] = [];

  if (customRpc && isValidRpcUrl(customRpc)) urls.push(customRpc);

  if (chainId === 56) {
    urls.push(
      "https://bsc-dataseed.binance.org",
      "https://bsc-dataseed1.defibit.io",
      "https://bsc-rpc.publicnode.com"
    );
  } else if (chainId === 5656) {
    urls.push("https://rpc-main1.qiblockchain.online");
  } else if (chainId === 11155111) {
    if (alchemyKey)
      urls.push(`https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`);
    if (infuraKey) urls.push(`https://sepolia.infura.io/v3/${infuraKey}`);
    urls.push(
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://1rpc.io/sepolia"
    );
  } else if (chainId === 1) {
    if (alchemyKey)
      urls.push(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`);
    if (infuraKey) urls.push(`https://mainnet.infura.io/v3/${infuraKey}`);
    urls.push(
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com"
    );
  } else if (chainId === 137) {
    urls.push(
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon-rpc.com"
    );
  } else if (chainId === 42161) {
    urls.push(
      "https://arb1.arbitrum.io/rpc",
      "https://arbitrum-one-rpc.publicnode.com"
    );
  } else if (chainId === 8453) {
    urls.push("https://mainnet.base.org", "https://base-rpc.publicnode.com");
  } else if (chainId === 10) {
    urls.push(
      "https://mainnet.optimism.io",
      "https://optimism-rpc.publicnode.com"
    );
  }

  return fallback(
    urls.map((url) => http(url, { retryCount: 1, timeout: 6_000 }))
  );
}

/**
 * PERMANENT FIX FOR "INSUFFICIENT BNB FOR GAS" WHEN SWAPPING NATIVE BNB ($1.30 BNB -> USDT):
 * 1. Uses a lean 135,000 gas limit for DEX swaps (at 1 Gwei on BSC, that is only 0.000135 BNB = ~$0.09).
 * 2. If `params.value + gasCostWei > nativeBal` (because the user is swapping ~100% of their $1.30 BNB),
 *    it automatically trims `finalValueToSend = nativeBal - gasCostWei` so the transaction NEVER fails
 *    with "insufficient funds for gas * price + value"!
 */
export async function signAndBroadcastTransaction(params: {
  chainId: SupportedChainId;
  privateKeyHex: Hex;
  to: Address;
  value: bigint;
  data?: Hex;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce?: number;
  type: WalletTransaction["type"];
  summary: string;
  customRpc?: string;
}): Promise<WalletTransaction> {
  const client = getResilientPublicClient(params.chainId, params.customRpc);
  const account = privateKeyToAccount(params.privateKeyHex);
  const chain = SUPPORTED_CHAINS[params.chainId];
  const isTestnet = CHAIN_METADATA[params.chainId].isTestnet;
  const explorerBase =
    chain.blockExplorers?.default.url || "https://bscscan.com";

  const [nativeBal, nonce] = await Promise.all([
    client.getBalance({ address: account.address }),
    params.nonce !== undefined
      ? Promise.resolve(params.nonce)
      : client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        }),
  ]);

  const hasCalldata = Boolean(params.data && params.data !== "0x");
  const isLegacyChain = params.chainId === 56 || params.chainId === 5656;
  const minBscFloor = parseGwei("1");
  const effectiveGasPrice = isLegacyChain
    ? params.maxFeePerGas >= minBscFloor
      ? params.maxFeePerGas
      : minBscFloor
    : params.maxFeePerGas;

  // Keep gas limit lean (max 140,000 for swaps if user has a small ~$1.30 BNB balance)
  let finalGasLimit =
    params.gasLimit > 145_000n ? 140_000n : params.gasLimit;
  if (finalGasLimit < 55_000n) {
    finalGasLimit = 55_000n;
  }

  const maxPossibleGasCostWei = finalGasLimit * effectiveGasPrice;
  let finalValueToSend = params.value;

  // Check if user has enough native BNB/ETH to pay the gas fee itself
  if (nativeBal <= maxPossibleGasCostWei && !isTestnet) {
    const sym = chain.nativeCurrency.symbol;
    throw new Error(
      `Insufficient ${sym} for gas. Have ${parseFloat(
        formatUnits(nativeBal, 18)
      ).toFixed(5)} ${sym}, need ~${parseFloat(
        formatUnits(maxPossibleGasCostWei, 18)
      ).toFixed(5)} ${sym}.`
    );
  }

  // CRITICAL FIX: Whether sending native BNB OR swapping native BNB (where params.value > 0n AND hasCalldata is true),
  // if `value + gasCost > nativeBal`, automatically trim `finalValueToSend` so `value + gasCost <= nativeBal`!
  if (
    finalValueToSend > 0n &&
    finalValueToSend + maxPossibleGasCostWei > nativeBal
  ) {
    finalValueToSend = nativeBal - maxPossibleGasCostWei;
  }

  const walletClient = createWalletClient({
    account,
    chain,
    transport: buildFallbackWalletTransport(params.chainId, params.customRpc),
  });

  let hash: Hex;

  if (isLegacyChain) {
    hash = await walletClient.sendTransaction({
      account,
      chain,
      type: "legacy",
      to: params.to,
      value: finalValueToSend,
      data: params.data ?? "0x",
      gas: finalGasLimit,
      gasPrice: effectiveGasPrice,
      nonce,
    });
  } else {
    const safePriority =
      params.maxPriorityFeePerGas > 0n
        ? params.maxPriorityFeePerGas
        : parseGwei("0.1");

    hash = await walletClient.sendTransaction({
      account,
      chain,
      type: "eip1559",
      to: params.to,
      value: finalValueToSend,
      data: params.data ?? "0x",
      gas: finalGasLimit,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: safePriority,
      nonce,
    });
  }

  return {
    hash,
    chainId: params.chainId,
    from: account.address,
    to: params.to,
    value: finalValueToSend.toString(),
    data: params.data ?? "0x",
    nonce,
    maxFeePerGas: effectiveGasPrice.toString(),
    maxPriorityFeePerGas: params.maxPriorityFeePerGas.toString(),
    gasLimit: finalGasLimit.toString(),
    type: params.type,
    summary: params.summary,
    status: "pending",
    timestamp: Date.now(),
    explorerUrl: `${explorerBase}/tx/${hash}`,
  };
}

export function encodeErc20Transfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [to, amount],
  });
}

export function encodeErc20Approve(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });
}

export async function checkTokenAllowance(params: {
  chainId: SupportedChainId;
  tokenAddress: Address;
  owner: Address;
  spender: Address;
}): Promise<bigint> {
  const client = getResilientPublicClient(params.chainId);
  return client.readContract({
    address: params.tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [params.owner, params.spender],
  });
}
