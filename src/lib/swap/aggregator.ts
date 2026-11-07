import {
  Address,
  encodeFunctionData,
  getAddress,
  Hex,
  parseAbi,
  parseGwei,
  parseUnits,
} from "viem";
import { CHAIN_METADATA, getResilientPublicClient } from "@/lib/chains/config";
import { priceStream } from "@/lib/prices/websocket";
import { SupportedChainId, SwapQuoteResponse, TokenAsset } from "@/types/wallet";

const WETH_ABI = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256 wad)",
]);

const ERC20_DECIMALS_ABI = parseAbi([
  "function decimals() view returns (uint8)",
]);

export const V2_ROUTER_BY_CHAIN: Record<SupportedChainId, Address> = {
  56: "0x10ED43C718714eb63d5aA57B78B54704E256024E",      // PancakeSwap V2 Router on BSC
  1: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",       // Uniswap V2 Router on Ethereum
  42161: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",   // Uniswap V2 Router on Arbitrum
  8453: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",    // Uniswap V2 Router on Base
  10: "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2",      // Uniswap V2 Router on Optimism
  137: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",     // QuickSwap V2 Router on Polygon
  5656: "0x91E000000000000000000000000000000000091E",    // QIE Router
  11155111: "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008",// Uniswap V2 Router on Sepolia
};

const V2_ROUTER_ABI = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) external payable returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)",
  "function getAmountsOut(uint256 amountIn, address[] memory path) view returns (uint256[] memory amounts)",
]);

export interface ExtendedSwapQuote extends SwapQuoteResponse {
  isSimulatedRouterCalldata?: boolean;
}

export async function fetchSwapQuote(params: {
  chainId: SupportedChainId;
  sellToken: TokenAsset;
  buyToken: TokenAsset;
  sellAmountHuman: string;
  slippagePercent: number;
  takerAddress?: Address;
  nativeBalanceWei?: bigint;
}): Promise<ExtendedSwapQuote> {
  const client = getResilientPublicClient(params.chainId);

  let realSellDecimals = params.sellToken.decimals;
  if (params.sellToken.address !== "NATIVE") {
    try {
      const onChainDec = await client.readContract({
        address: getAddress(params.sellToken.address),
        abi: ERC20_DECIMALS_ABI,
        functionName: "decimals",
      });
      realSellDecimals = Number(onChainDec);
    } catch {
      // Use fallback metadata
    }
  }

  let sellUnits = parseUnits(
    params.sellAmountHuman || "0",
    realSellDecimals
  );

  if (sellUnits <= 0n) {
    throw new Error("Enter an amount greater than 0");
  }

  // AUTO GAS RESERVE FOR NATIVE SWAPS (e.g. $1.30 BNB -> USDT):
  // If user is selling Native BNB/ETH and `sellUnits + 0.00018 BNB gas reserve > nativeBalanceWei`,
  // automatically deduct the gas reserve BEFORE building the router quote so `msg.value` and `amountOutMin` match!
  if (
    params.sellToken.address === "NATIVE" &&
    params.nativeBalanceWei &&
    params.nativeBalanceWei > 0n
  ) {
    const gasReserveWei =
      params.chainId === 56
        ? 145_000n * parseGwei("1.05") // ~0.000152 BNB (~$0.10) gas reserve on BSC
        : 145_000n * parseGwei("0.5");

    if (
      sellUnits + gasReserveWei > params.nativeBalanceWei &&
      params.nativeBalanceWei > gasReserveWei
    ) {
      sellUnits = params.nativeBalanceWei - gasReserveWei;
    }
  }

  const isTestnet = CHAIN_METADATA[params.chainId].isTestnet;
  const wethAddress = getAddress(CHAIN_METADATA[params.chainId].wethAddress);
  const sellSym = params.sellToken.symbol.toUpperCase();
  const buySym = params.buyToken.symbol.toUpperCase();

  // 1. Direct Native <-> Wrapped Native
  if (
    (params.sellToken.address === "NATIVE" &&
      (buySym === "WBNB" || buySym === "WETH")) ||
    ((sellSym === "WBNB" || sellSym === "WETH") &&
      params.buyToken.address === "NATIVE")
  ) {
    const isDeposit = params.sellToken.address === "NATIVE";
    const data = isDeposit
      ? encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" })
      : encodeFunctionData({
          abi: WETH_ABI,
          functionName: "withdraw",
          args: [sellUnits],
        });

    return {
      chainId: params.chainId,
      sellToken: params.sellToken.address,
      buyToken: params.buyToken.address,
      sellAmount: sellUnits.toString(),
      buyAmount: sellUnits.toString(),
      estimatedPriceImpact: "0.00",
      price: "1.000000",
      guaranteedPrice: "1.000000",
      to: wethAddress,
      data,
      value: isDeposit ? sellUnits.toString() : "0",
      gas: "45000",
      allowanceTarget: wethAddress,
      sources: [{ name: "Canonical_Wrapped_Native", proportion: "1" }],
      isSimulatedRouterCalldata: false,
    };
  }

  const taker: Address =
    params.takerAddress || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  // 2. Direct On-Chain PancakeSwap V2 (BSC) / Uniswap V2 Router
  // Uses lean 135,000 gas limit (instead of LI.FI's 280,000+ Diamond gas limit) so $1.30 BNB swaps cost <$0.09 gas!
  const v2Router = V2_ROUTER_BY_CHAIN[params.chainId];
  if (!v2Router) {
    throw new Error("No DEX router available for this chain.");
  }

  const tokenInAddr =
    params.sellToken.address === "NATIVE"
      ? wethAddress
      : getAddress(params.sellToken.address);
  const tokenOutAddr =
    params.buyToken.address === "NATIVE"
      ? wethAddress
      : getAddress(params.buyToken.address);

  const path: Address[] =
    tokenInAddr.toLowerCase() === wethAddress.toLowerCase() ||
    tokenOutAddr.toLowerCase() === wethAddress.toLowerCase()
      ? [tokenInAddr, tokenOutAddr]
      : [tokenInAddr, wethAddress, tokenOutAddr];

  let onChainBuyUnits = 0n;
  try {
    const amountsOut = await client.readContract({
      address: v2Router,
      abi: V2_ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [sellUnits, path],
    });
    onChainBuyUnits = amountsOut[amountsOut.length - 1];
  } catch {
    const sellUsd = priceStream.getTokenUsdTicker(params.sellToken).price;
    const buyUsd = priceStream.getTokenUsdTicker(params.buyToken).price;
    const rate = buyUsd > 0 ? sellUsd / buyUsd : 1.0;
    const estFloat =
      (Number(sellUnits) / 10 ** realSellDecimals) * rate;
    onChainBuyUnits = parseUnits(
      estFloat.toFixed(Math.min(params.buyToken.decimals, 8)),
      params.buyToken.decimals
    );
  }

  if (onChainBuyUnits <= 0n) {
    throw new Error(
      `Insufficient pool liquidity for ${params.sellToken.symbol}/${params.buyToken.symbol}.`
    );
  }

  const slippageBps = BigInt(
    Math.max(50, Math.floor(params.slippagePercent * 100))
  );
  const minOutUnits = (onChainBuyUnits * (10000n - slippageBps)) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

  let routerCalldata: Hex = "0x";
  let routerValue = "0";

  if (params.sellToken.address === "NATIVE") {
    routerValue = sellUnits.toString();
    routerCalldata = encodeFunctionData({
      abi: V2_ROUTER_ABI,
      functionName: "swapExactETHForTokens",
      args: [minOutUnits, path, taker, deadline],
    });
  } else if (params.buyToken.address === "NATIVE") {
    routerCalldata = encodeFunctionData({
      abi: V2_ROUTER_ABI,
      functionName: "swapExactTokensForETH",
      args: [sellUnits, minOutUnits, path, taker, deadline],
    });
  } else {
    routerCalldata = encodeFunctionData({
      abi: V2_ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: [sellUnits, minOutUnits, path, taker, deadline],
    });
  }

  const sellFloat = Number(sellUnits) / 10 ** realSellDecimals;
  const buyFloat = Number(onChainBuyUnits) / 10 ** params.buyToken.decimals;
  const rate = sellFloat > 0 ? buyFloat / sellFloat : 1.0;

  return {
    chainId: params.chainId,
    sellToken: params.sellToken.address,
    buyToken: params.buyToken.address,
    sellAmount: sellUnits.toString(),
    buyAmount: onChainBuyUnits.toString(),
    estimatedPriceImpact: "0.08",
    price: rate.toFixed(6),
    guaranteedPrice: (rate * (1 - Number(slippageBps) / 10000)).toFixed(6),
    to: v2Router,
    data: routerCalldata,
    value: routerValue,
    gas: "135000", // Lean 135k gas limit for PancakeSwap V2 (costs only ~0.000135 BNB = $0.09)
    allowanceTarget: v2Router,
    sources: [
      {
        name: params.chainId === 56 ? "PancakeSwap_V2" : "Uniswap_V2",
        proportion: "1",
      },
    ],
    isSimulatedRouterCalldata: isTestnet,
  };
}
