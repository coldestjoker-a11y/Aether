import {
  Address,
  createWalletClient,
  encodeFunctionData,
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
import { deriveAssetVaultAccount } from "@/lib/crypto/assetAddresses";
import { signAndBroadcastTransaction } from "@/lib/tx/engine";
import {
  SupportedChainId,
  TokenAsset,
  WalletTransaction,
} from "@/types/wallet";

const ERC20_RELAY_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function nonces(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
]);

/**
 * Solves the "Sub-Vault Gas Trap":
 * If real ERC-20 tokens (e.g., USDC) sit on the token's dedicated `vaultAddress`,
 * that sub-vault address often has `0 ETH` for gas.
 *
 * Strategy:
 * 1. Checks how much of `amountWei` sits on `masterAddress` vs `vaultAddress`.
 * 2. If tokens sit on `vaultAddress` and `vaultAddress` has `0 ETH`:
 *    - Path A (Gasless EIP-2612 Permit): Signs an off-chain EIP-712 `Permit` with `vaultPrivateKey`
 *      authorizing `masterAddress`, then `masterAddress` (which holds ETH) pays the gas to transfer the tokens!
 *    - Path B (Master Gas Top-Up): If the token contract does not support EIP-2612 `permit()`,
 *      `masterAddress` automatically tops up the exact micro-gas needed (`~0.00015 ETH`) to `vaultAddress`
 *      and `vaultAddress` signs and dispatches the `ERC20.transfer(recipient, amountWei)`.
 */
export async function executeSmartAssetTransfer(params: {
  chainId: SupportedChainId;
  masterPrivateKey: Hex;
  token: TokenAsset;
  recipient: Address;
  amountWei: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  customRpc?: string;
}): Promise<WalletTransaction> {
  const client = getResilientPublicClient(params.chainId, params.customRpc);
  const masterAccount = privateKeyToAccount(params.masterPrivateKey);
  const chain = SUPPORTED_CHAINS[params.chainId];

  const { vaultAddress, vaultPrivateKey, isSubVault } = deriveAssetVaultAccount({
    masterAddress: masterAccount.address,
    sessionPrivateKey: params.masterPrivateKey,
    token: params.token,
  });

  // 1. Native ETH Transfer always dispatches from Master Account
  if (params.token.address === "NATIVE") {
    return signAndBroadcastTransaction({
      chainId: params.chainId,
      privateKeyHex: params.masterPrivateKey,
      to: params.recipient,
      value: params.amountWei,
      data: "0x",
      gasLimit: 21_000n,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      type: "send",
      summary: `Send ${params.token.symbol} to ${params.recipient.slice(0, 6)}...`,
      customRpc: params.customRpc,
    });
  }

  // 2. Check ERC-20 balance on Master vs Dedicated Pair Sub-Vault
  const [masterTokenBal, subVaultTokenBal, subVaultEthBal] = await Promise.all([
    client
      .readContract({
        address: params.token.address,
        abi: ERC20_RELAY_ABI,
        functionName: "balanceOf",
        args: [masterAccount.address],
      })
      .catch(() => 0n),
    isSubVault
      ? client
          .readContract({
            address: params.token.address,
            abi: ERC20_RELAY_ABI,
            functionName: "balanceOf",
            args: [vaultAddress],
          })
          .catch(() => 0n)
      : Promise.resolve(0n),
    isSubVault
      ? client.getBalance({ address: vaultAddress }).catch(() => 0n)
      : Promise.resolve(0n),
  ]);

  // Case 2A: Master address holds enough of the ERC-20 token -> send directly from Master
  if (masterTokenBal >= params.amountWei || !isSubVault || !vaultPrivateKey) {
    const data = encodeFunctionData({
      abi: ERC20_RELAY_ABI,
      functionName: "transfer",
      args: [params.recipient, params.amountWei],
    });

    return signAndBroadcastTransaction({
      chainId: params.chainId,
      privateKeyHex: params.masterPrivateKey,
      to: params.token.address,
      value: 0n,
      data,
      gasLimit: 95_000n,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      type: "send",
      summary: `Send ${params.token.symbol} to ${params.recipient.slice(0, 6)}...`,
      customRpc: params.customRpc,
    });
  }

  // Case 2B: Dedicated Pair Sub-Vault holds the ERC-20 tokens!
  const requiredGasEth = 85_000n * params.maxFeePerGas;

  // If the sub-vault doesn't have enough ETH for gas, try EIP-2612 Gasless Permit first
  if (subVaultTokenBal >= params.amountWei && subVaultEthBal < requiredGasEth) {
    try {
      const subVaultAccount = privateKeyToAccount(vaultPrivateKey);
      const [tokenName, permitNonce] = await Promise.all([
        client.readContract({
          address: params.token.address,
          abi: ERC20_RELAY_ABI,
          functionName: "name",
        }),
        client.readContract({
          address: params.token.address,
          abi: ERC20_RELAY_ABI,
          functionName: "nonces",
          args: [vaultAddress],
        }),
      ]);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      // Sign EIP-2612 Permit off-chain with Sub-Vault Private Key (0 gas required!)
      const signature = await subVaultAccount.signTypedData({
        domain: {
          name: tokenName,
          version: params.token.symbol === "USDC" ? "2" : "1",
          chainId: params.chainId,
          verifyingContract: params.token.address,
        },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: {
          owner: vaultAddress,
          spender: masterAccount.address,
          value: params.amountWei,
          nonce: permitNonce,
          deadline,
        },
      });

      const r = `0x${signature.slice(2, 66)}` as Hex;
      const s = `0x${signature.slice(66, 130)}` as Hex;
      const v = parseInt(signature.slice(130, 132), 16);

      // Master account pays gas to submit Permit + transferFrom!
      const permitData = encodeFunctionData({
        abi: ERC20_RELAY_ABI,
        functionName: "permit",
        args: [
          vaultAddress,
          masterAccount.address,
          params.amountWei,
          deadline,
          v,
          r,
          s,
        ],
      });

      await signAndBroadcastTransaction({
        chainId: params.chainId,
        privateKeyHex: params.masterPrivateKey,
        to: params.token.address,
        value: 0n,
        data: permitData,
        gasLimit: 95_000n,
        maxFeePerGas: params.maxFeePerGas,
        maxPriorityFeePerGas: params.maxPriorityFeePerGas,
        type: "approve",
        summary: `Gasless EIP-2612 Permit (${params.token.symbol} Sub-Vault)`,
        customRpc: params.customRpc,
      });

      const transferFromData = encodeFunctionData({
        abi: ERC20_RELAY_ABI,
        functionName: "transferFrom",
        args: [vaultAddress, params.recipient, params.amountWei],
      });

      return signAndBroadcastTransaction({
        chainId: params.chainId,
        privateKeyHex: params.masterPrivateKey,
        to: params.token.address,
        value: 0n,
        data: transferFromData,
        gasLimit: 95_000n,
        maxFeePerGas: params.maxFeePerGas,
        maxPriorityFeePerGas: params.maxPriorityFeePerGas,
        type: "send",
        summary: `Relayed ${params.token.symbol} from Pair Vault to ${params.recipient.slice(0, 6)}...`,
        customRpc: params.customRpc,
      });
    } catch {
      // Fallback: Auto-Top-Up Micro-Gas from Master to Sub-Vault, then dispatch from Sub-Vault
      const walletClient = createWalletClient({
        account: masterAccount,
        chain,
        transport: http(),
      });
      await walletClient
        .sendTransaction({
          account: masterAccount,
          chain,
          to: vaultAddress,
          value: requiredGasEth + parseGwei("10000"),
        })
        .catch(() => {});
    }
  }

  // Case 2C: Sub-Vault already has gas -> dispatch directly from Sub-Vault Key
  const transferData = encodeFunctionData({
    abi: ERC20_RELAY_ABI,
    functionName: "transfer",
    args: [params.recipient, params.amountWei],
  });

  return signAndBroadcastTransaction({
    chainId: params.chainId,
    privateKeyHex: vaultPrivateKey,
    to: params.token.address,
    value: 0n,
    data: transferData,
    gasLimit: 95_000n,
    maxFeePerGas: params.maxFeePerGas,
    maxPriorityFeePerGas: params.maxPriorityFeePerGas,
    type: "send",
    summary: `Send ${params.token.symbol} to ${params.recipient.slice(0, 6)}...`,
    customRpc: params.customRpc,
  });
}

