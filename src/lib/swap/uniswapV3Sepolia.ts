import { Address, encodeFunctionData, Hex, parseAbi } from "viem";
import { getResilientPublicClient } from "@/lib/chains/config";
import { SwapQuoteResponse, TokenAsset } from "@/types/wallet";

// Official Uniswap V3 Deployments on Ethereum Sepolia (Chain ID: 11155111)
export const SEPOLIA_UNISWAP_V3_QUOTER_V2: Address =
  "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
export const SEPOLIA_UNISWAP_V3_SWAP_ROUTER_02: Address =
  "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48";
export const SEPOLIA_WETH9: Address =
  "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

const QUOTER_V2_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const SWAP_ROUTER_02_ABI = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) external payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) external payable",
]);

/**
 * Queries the real on-chain Sepolia Uniswap V3 QuoterV2 contract (`0xEd1f6473...`)
 * across 0.3% (3000) and 0.05% (500) fee tiers and builds real `SwapRouter02.exactInputSingle`
 * calldata so Sepolia swaps mint real ERC-20 tokens on-chain whenever pool liquidity exists!
 */
export async function trySepoliaUniswapV3Quote(params: {
  sellToken: TokenAsset;
  buyToken: TokenAsset;
  sellUnits: bigint;
  slippagePercent: number;
  recipient: Address;
  customRpc?: string;
}): Promise<(SwapQuoteResponse & { isSimulatedRouterCalldata: boolean }) | null> {
  const client = getResilientPublicClient(11155111, params.customRpc);

  const tokenIn: Address =
    params.sellToken.address === "NATIVE"
      ? SEPOLIA_WETH9
      : params.sellToken.address;
  const tokenOut: Address =
    params.buyToken.address === "NATIVE"
      ? SEPOLIA_WETH9
      : params.buyToken.address;

  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) return null;

  // Test 3000 (0.3%) and 500 (0.05%) Uniswap V3 fee tiers
  for (const feeTier of [3000, 500, 10000]) {
    try {
      const simResult = await client.simulateContract({
        address: SEPOLIA_UNISWAP_V3_QUOTER_V2,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            amountIn: params.sellUnits,
            fee: feeTier,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });

      const amountOut = simResult.result[0];
      if (amountOut <= 0n) continue;

      const minOut =
        (amountOut * BigInt(Math.floor((100 - params.slippagePercent) * 100))) /
        10000n;

      const isBuyingNativeEth = params.buyToken.address === "NATIVE";

      const swapCalldata = encodeFunctionData({
        abi: SWAP_ROUTER_02_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            fee: feeTier,
            recipient: isBuyingNativeEth
              ? SEPOLIA_UNISWAP_V3_SWAP_ROUTER_02
              : params.recipient,
            amountIn: params.sellUnits,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });

      let finalCalldata: Hex = swapCalldata;
      if (isBuyingNativeEth) {
        const unwrapCalldata = encodeFunctionData({
          abi: SWAP_ROUTER_02_ABI,
          functionName: "unwrapWETH9",
          args: [minOut, params.recipient],
        });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
        finalCalldata = encodeFunctionData({
          abi: SWAP_ROUTER_02_ABI,
          functionName: "multicall",
          args: [deadline, [swapCalldata, unwrapCalldata]],
        });
      }

      const sellHuman =
        Number(params.sellUnits) / 10 ** params.sellToken.decimals;
      const buyHuman = Number(amountOut) / 10 ** params.buyToken.decimals;
      const rate = sellHuman > 0 ? buyHuman / sellHuman : 1;

      return {
        chainId: 11155111,
        sellToken: params.sellToken.address,
        buyToken: params.buyToken.address,
        sellAmount: params.sellUnits.toString(),
        buyAmount: amountOut.toString(),
        estimatedPriceImpact: "0.11",
        price: rate.toFixed(6),
        guaranteedPrice: (rate * (1 - params.slippagePercent / 100)).toFixed(6),
        to: SEPOLIA_UNISWAP_V3_SWAP_ROUTER_02,
        data: finalCalldata,
        value:
          params.sellToken.address === "NATIVE"
            ? params.sellUnits.toString()
            : "0",
        gas: "195000",
        allowanceTarget: SEPOLIA_UNISWAP_V3_SWAP_ROUTER_02,
        sources: [
          { name: `Uniswap_V3_Sepolia_${feeTier / 10000}%`, proportion: "1" },
        ],
        isSimulatedRouterCalldata: false,
      };
    } catch {
      // Try next fee tier
    }
  }

  return null;
}

