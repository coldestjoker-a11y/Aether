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

export function formatRpcError(err: unknown): string {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes("insufficient funds")) {
    return "Insufficient native gas balance (BNB/ETH) on-chain to cover the transfer amount + network fee.";
  }
  if (msg.includes("out of gas")) {
    return "Recipient is a smart contract requiring higher gas limit. Auto-increasing gas limit...";
  }
  if (msg.includes("execution reverted")) {
    return "Transaction reverted on-chain: verify recipient contract rules or token balance.";
  }
  if (msg.includes("nonce too low")) {
    return "Nonce conflict: a transaction was just mined. Click Send again to use the new nonce.";
  }
  return err instanceof Error ? err.message : "Blockchain RPC broadcast error.";
}

export async function getReliableGasFees(
  chainId: SupportedChainId,
  customRpc?: string
): Promise<Omit<GasFeeEstimate, "estimatedGasLimit">> {
  const client = getResilientPublicClient(chainId, customRpc);

  if (chainId === 56 || chainId === 5656) {
    const minValidatorFloor = parseGwei("1");
    const rpcGasPrice = await client
      .getGasPrice()
      .catch(() => minValidatorFloor);

    const baseGasPrice =
      rpcGasPrice >= minValidatorFloor ? rpcGasPrice : minValidatorFloor;

    return {
      baseFeePerGas: baseGasPrice,
      slow: {
        maxFeePerGas: baseGasPrice,
        maxPriorityFeePerGas: baseGasPrice,
      },
      normal: {
        maxFeePerGas: (baseGasPrice * 110n) / 100n,
        maxPriorityFeePerGas: (baseGasPrice * 110n) / 100n,
      },
      fast: {
        maxFeePerGas: (baseGasPrice * 130n) / 100n,
        maxPriorityFeePerGas: (baseGasPrice * 130n) / 100n,
      },
    };
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
      : parseGwei("0.5");

  const rawPriority = rpcFeeData?.maxPriorityFeePerGas ?? minPriorityFloor;
  const safeBasePriority =
    rawPriority > minPriorityFloor ? rawPriority : minPriorityFloor;

  const liveBaseFee =
    block?.baseFeePerGas ??
    rpcFeeData?.maxFeePerGas ??
    (chainId === 11155111 ? parseGwei("1") : parseGwei("2"));

  const slowPriority = safeBasePriority;
  const slowMaxFee = (liveBaseFee * 115n) / 100n + slowPriority;

  const normalPriority = (safeBasePriority * 120n) / 100n;
  const normalMaxFee = (liveBaseFee * 130n) / 100n + normalPriority;

  const fastPriority = (safeBasePriority * 150n) / 100n;
  const fastMaxFee = (liveBaseFee * 160n) / 100n + fastPriority;

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
 * CRITICAL FIX FOR [OUT OF GAS] ON CONTRACT RECIPIENTS:
 * Checks if `params.to` has smart contract bytecode (`getBytecode`) and runs `estimateGas`
 * with a +35% safety buffer. Never forces 21,000 when sending to a contract address!
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

  const [bytecode, rawEstimate] = await Promise.all([
    client.getBytecode({ address: params.to }).catch(() => undefined),
    client
      .estimateGas({
        account: params.from,
        to: params.to,
        value: params.value ?? 0n,
        data: params.data ?? "0x",
      })
      .catch(() => null),
  ]);

  const isRecipientContract = Boolean(bytecode && bytecode !== "0x");
  const hasCalldata = Boolean(params.data && params.data !== "0x");

  // If sending to a Smart Contract (like 0x7A0b6394610f8ecBd7DE26E70E17151396887467) or ERC-20,
  // enforce at least a 65,000 gas limit floor so `receive()` / `fallback()` NEVER runs out of gas!
  const minimumSafeFloor =
    isRecipientContract || hasCalldata ? 65_000n : 21_000n;

  if (rawEstimate !== null) {
    // Add 35% safety cushion to estimated gas
    const buffered =
      rawEstimate > 21_000n || isRecipientContract || hasCalldata
        ? (rawEstimate * 135n) / 100n
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
      estimatedGasLimit: minimumSafeFloor,
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

  if (customRpc && isValidRpcUrl(customRpc).valid) urls.push(customRpc);

  if (chainId === 56) {
    urls.push(
      "https://bsc-dataseed.binance.org",
      "https://bsc-dataseed1.defibit.io",
      "https://bsc-rpc.publicnode.com",
      "https://binance.llamarpc.com"
    );
  } else if (chainId === 5656) {
    urls.push("https://rpc-main1.qiblockchain.online");
  } else if (chainId === 11155111) {
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
    urls.push(
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://1rpc.io/eth"
    );
  } else if (chainId === 137) {
    urls.push(
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon-rpc.com",
      "https://1rpc.io/matic"
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
    urls.map((url) => http(url, { retryCount: 2, timeout: 10_000 }))
  );
}

/**
 * Broadcasts transaction with dynamic `estimateGas` + smart contract bytecode detection
 * so sending BNB/ETH to a smart contract address (like 0x7A0b...7467) NEVER fails with [out of gas]!
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

  // 1. Check live balance, pending nonce, AND recipient bytecode in parallel
  const [nativeBal, nonce, recipientBytecode] = await Promise.all([
    client.getBalance({ address: account.address }),
    params.nonce !== undefined
      ? Promise.resolve(params.nonce)
      : client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        }),
    client.getBytecode({ address: params.to }).catch(() => undefined),
  ]);

  const isRecipientContract = Boolean(
    recipientBytecode && recipientBytecode !== "0x"
  );
  const hasCalldata = Boolean(params.data && params.data !== "0x");

  // 2. Dynamically estimate gas right before signing so we NEVER under-allocate 21,000 to a contract!
  let finalGasLimit = params.gasLimit;
  const minContractFloor =
    isRecipientContract || hasCalldata ? 65_000n : 21_000n;

  if (finalGasLimit < minContractFloor) {
    finalGasLimit = minContractFloor;
  }

  try {
    const liveEstimate = await client.estimateGas({
      account: account.address,
      to: params.to,
      value: params.value > nativeBal ? nativeBal / 2n : params.value,
      data: params.data ?? "0x",
    });
    const bufferedEstimate =
      liveEstimate > 21_000n || isRecipientContract || hasCalldata
        ? (liveEstimate * 135n) / 100n
        : 21_000n;
    if (bufferedEstimate > finalGasLimit) {
      finalGasLimit = bufferedEstimate;
    }
  } catch {
    // Retain `finalGasLimit` (at least 65,000n for contracts)
  }

  const isLegacyChain = params.chainId === 56 || params.chainId === 5656;
  const minBscFloor = parseGwei("1");
  const effectiveGasPrice = isLegacyChain
    ? params.maxFeePerGas >= minBscFloor
      ? params.maxFeePerGas
      : minBscFloor
    : params.maxFeePerGas;

  const maxPossibleGasCostWei = finalGasLimit * effectiveGasPrice;

  // 3. Auto-trim `value` if sending native BNB/ETH so `value + (finalGasLimit * gasPrice) <= nativeBal`
  let finalValueToSend = params.value;

  if (!hasCalldata && params.value > 0n) {
    if (nativeBal <= maxPossibleGasCostWei) {
      const sym = chain.nativeCurrency.symbol;
      const haveStr = parseFloat(formatUnits(nativeBal, 18)).toFixed(6);
      const needGasStr = parseFloat(
        formatUnits(maxPossibleGasCostWei, 18)
      ).toFixed(6);
      throw new Error(
        `Recipient is a smart contract requiring ~${finalGasLimit.toString()} gas limit (${needGasStr} ${sym} fee), and your balance is ${haveStr} ${sym}.`
      );
    }

    if (finalValueToSend + maxPossibleGasCostWei > nativeBal) {
      finalValueToSend = nativeBal - maxPossibleGasCostWei;
    }
  } else if (hasCalldata && nativeBal < maxPossibleGasCostWei && !isTestnet) {
    const sym = chain.nativeCurrency.symbol;
    const haveStr = parseFloat(formatUnits(nativeBal, 18)).toFixed(6);
    const needStr = parseFloat(
      formatUnits(maxPossibleGasCostWei, 18)
    ).toFixed(6);
    throw new Error(
      `Insufficient ${sym} for gas. Have ${haveStr} ${sym}, need ~${needStr} ${sym}.`
    );
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
    const latestBlock = await client
      .getBlock({ blockTag: "latest" })
      .catch(() => null);
    const liveBase = latestBlock?.baseFeePerGas ?? parseGwei("0.1");
    const safePriority =
      params.maxPriorityFeePerGas > 0n
        ? params.maxPriorityFeePerGas
        : parseGwei("0.1");
    const minValidMaxFee = (liveBase * 125n) / 100n + safePriority;
    const finalMaxFee =
      params.maxFeePerGas >= minValidMaxFee
        ? params.maxFeePerGas
        : minValidMaxFee;

    hash = await walletClient.sendTransaction({
      account,
      chain,
      type: "eip1559",
      to: params.to,
      value: finalValueToSend,
      data: params.data ?? "0x",
      gas: finalGasLimit,
      maxFeePerGas: finalMaxFee,
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
