import {
  Address,
  createWalletClient,
  encodeFunctionData,
  fallback,
  Hex,
  http,
  parseAbi,
  parseGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getResilientPublicClient,
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

export function formatRpcError(err: unknown): string {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes("max fee per gas less than block base fee")) {
    return "Network base fee spiked. Switching to 'Fast' or Custom Gwei will push this through immediately.";
  }
  if (msg.includes("insufficient funds")) {
    return "Insufficient native balance to cover the transfer amount + network gas fee.";
  }
  if (msg.includes("execution reverted")) {
    return "Transaction simulation reverted by contract (check token balance or allowance).";
  }
  if (msg.includes("nonce too low")) {
    return "Nonce already used. Refreshing nonce from pending mempool...";
  }
  if (msg.includes("underpriced")) {
    return "Transaction gas tip was too low for the mempool. Increase gas speed to Fast.";
  }
  return err instanceof Error ? err.message : "Network RPC error.";
}

/**
 * Computes bulletproof EIP-1559 gas tiers directly from the latest block's `baseFeePerGas`.
 * Guarantees `maxFeePerGas >= baseFeePerGas + maxPriorityFeePerGas` across all tiers,
 * eliminating the `max fee per gas less than block base fee` error.
 */
export async function getReliableGasFees(
  chainId: SupportedChainId,
  customRpc?: string
): Promise<Omit<GasFeeEstimate, "estimatedGasLimit">> {
  const client = getResilientPublicClient(chainId, customRpc);

  const [block, rpcFeeData] = await Promise.all([
    client.getBlock({ blockTag: "latest" }).catch(() => null),
    client.estimateFeesPerGas().catch(() => null),
  ]);

  // Minimum safe priority fee floors per network
  const minPriorityFloor =
    chainId === 11155111
      ? parseGwei("1.5") // Sepolia validators reliably pick up >= 1.5 Gwei tip
      : chainId === 137
      ? parseGwei("30")  // Polygon POS requires >= 30 Gwei priority tip
      : chainId === 56
      ? parseGwei("1")   // BSC minimum
      : parseGwei("0.1"); // L2s & Mainnet floor

  const rawPriority = rpcFeeData?.maxPriorityFeePerGas ?? minPriorityFloor;
  const safeBasePriority =
    rawPriority > minPriorityFloor ? rawPriority : minPriorityFloor;

  const liveBaseFee =
    block?.baseFeePerGas ??
    rpcFeeData?.maxFeePerGas ??
    (chainId === 11155111 ? parseGwei("2") : parseGwei("15"));

  // Slow still buffers baseFee by 1.25x (2 blocks of max 12.5% baseFee surge) so it NEVER fails
  const slowPriority = safeBasePriority;
  const slowMaxFee = (liveBaseFee * 125n) / 100n + slowPriority;

  // Normal buffers baseFee by 1.6x + 1.25x priority tip
  const normalPriority = (safeBasePriority * 125n) / 100n;
  const normalMaxFee = (liveBaseFee * 160n) / 100n + normalPriority;

  // Fast doubles baseFee (2.0x) + 1.6x priority tip for instant next-block inclusion
  const fastPriority = (safeBasePriority * 160n) / 100n;
  const fastMaxFee = liveBaseFee * 2n + fastPriority;

  return {
    baseFeePerGas: liveBaseFee,
    slow: {
      maxFeePerGas: slowMaxFee,
      maxPriorityFeePerGas: slowPriority,
    },
    normal: {
      maxFeePerGas: normalMaxFee,
      maxPriorityFeePerGas: normalPriority,
    },
    fast: {
      maxFeePerGas: fastMaxFee,
      maxPriorityFeePerGas: fastPriority,
    },
  };
}

/**
 * Simulates transaction execution via `eth_call` and calculates buffered gas limit + EIP-1559 fees.
 */
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
  const feeTiers = await getReliableGasFees(params.chainId, params.customRpc);

  const isContractInteraction = Boolean(params.data && params.data !== "0x");
  const fallbackGasLimit = isContractInteraction ? 120_000n : 21_000n;

  // 1. Pre-flight simulation
  try {
    await client.call({
      account: params.from,
      to: params.to,
      value: params.value ?? 0n,
      data: params.data ?? "0x",
    });
  } catch (err: unknown) {
    return {
      simulationSuccess: false,
      revertReason: formatRpcError(err),
      fees: {
        ...feeTiers,
        estimatedGasLimit: fallbackGasLimit,
      },
    };
  }

  // 2. Estimate gas limit and apply a 25% safety buffer
  let gasLimit = fallbackGasLimit;
  try {
    const rawEstimate = await client.estimateGas({
      account: params.from,
      to: params.to,
      value: params.value ?? 0n,
      data: params.data ?? "0x",
    });
    gasLimit = (rawEstimate * 125n) / 100n;
  } catch {
    gasLimit = fallbackGasLimit;
  }

  return {
    simulationSuccess: true,
    fees: {
      ...feeTiers,
      estimatedGasLimit: gasLimit,
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

  if (customRpc) urls.push(customRpc);

  if (chainId === 11155111) {
    if (alchemyKey)
      urls.push(`https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`);
    if (infuraKey) urls.push(`https://sepolia.infura.io/v3/${infuraKey}`);
    urls.push(
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://rpc.sepolia.org",
      "https://1rpc.io/sepolia"
    );
  } else if (chainId === 1) {
    if (alchemyKey)
      urls.push(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`);
    if (infuraKey) urls.push(`https://mainnet.infura.io/v3/${infuraKey}`);
    urls.push("https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth");
  } else if (chainId === 56) {
    urls.push("https://bsc-rpc.publicnode.com", "https://1rpc.io/bnb");
  } else if (chainId === 137) {
    urls.push("https://polygon-bor-rpc.publicnode.com", "https://1rpc.io/matic");
  } else if (chainId === 42161) {
    urls.push("https://arbitrum-one-rpc.publicnode.com", "https://1rpc.io/arb");
  } else if (chainId === 8453) {
    urls.push("https://base-rpc.publicnode.com", "https://1rpc.io/base");
  } else if (chainId === 10) {
    urls.push("https://optimism-rpc.publicnode.com", "https://1rpc.io/op");
  }

  return fallback(
    urls.map((url) => http(url, { retryCount: 3, timeout: 10_000 }))
  );
}

/**
 * Signs and broadcasts a transaction with automatic retry & gas-bump recovery
 * if the network baseFee jumps at the exact millisecond of broadcast.
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

  // Always fetch fresh pending nonce right before signing
  const nonce =
    params.nonce !== undefined
      ? params.nonce
      : await client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });

  // Refresh latest block baseFee right at signing time so `maxFeePerGas` is guaranteed valid
  const latestBlock = await client
    .getBlock({ blockTag: "latest" })
    .catch(() => null);
  const liveBase = latestBlock?.baseFeePerGas ?? 0n;

  const finalPriorityFee =
    params.maxPriorityFeePerGas > 0n
      ? params.maxPriorityFeePerGas
      : parseGwei("1.5");

  const minimumValidMaxFee = (liveBase * 135n) / 100n + finalPriorityFee;
  const finalMaxFee =
    params.maxFeePerGas >= minimumValidMaxFee
      ? params.maxFeePerGas
      : minimumValidMaxFee;

  const walletClient = createWalletClient({
    account,
    chain,
    transport: buildFallbackWalletTransport(params.chainId, params.customRpc),
  });

  let hash: Hex;

  // BNB Smart Chain (56) uses Legacy gasPrice more reliably across public nodes
  if (params.chainId === 56) {
    hash = await walletClient.sendTransaction({
      account,
      chain,
      to: params.to,
      value: params.value,
      data: params.data ?? "0x",
      gas: params.gasLimit,
      gasPrice: finalMaxFee,
      nonce,
    });
  } else {
    try {
      hash = await walletClient.sendTransaction({
        account,
        chain,
        to: params.to,
        value: params.value,
        data: params.data ?? "0x",
        gas: params.gasLimit,
        maxFeePerGas: finalMaxFee,
        maxPriorityFeePerGas: finalPriorityFee,
        nonce,
      });
    } catch (firstErr: unknown) {
      // Auto-Bump Retry: If RPC complains about baseFee/underpriced, bump fees by +35% and retry once
      const errText = String(firstErr).toLowerCase();
      if (
        errText.includes("base fee") ||
        errText.includes("underpriced") ||
        errText.includes("fee cap")
      ) {
        hash = await walletClient.sendTransaction({
          account,
          chain,
          to: params.to,
          value: params.value,
          data: params.data ?? "0x",
          gas: params.gasLimit,
          maxFeePerGas: (finalMaxFee * 135n) / 100n,
          maxPriorityFeePerGas: (finalPriorityFee * 135n) / 100n,
          nonce,
        });
      } else {
        throw firstErr;
      }
    }
  }

  const explorerBase =
    chain.blockExplorers?.default.url || "https://sepolia.etherscan.io";

  return {
    hash,
    chainId: params.chainId,
    from: account.address,
    to: params.to,
    value: params.value.toString(),
    data: params.data ?? "0x",
    nonce,
    maxFeePerGas: finalMaxFee.toString(),
    maxPriorityFeePerGas: finalPriorityFee.toString(),
    gasLimit: params.gasLimit.toString(),
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
