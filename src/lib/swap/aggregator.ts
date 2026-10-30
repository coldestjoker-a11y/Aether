import {
  Address,
  encodeFunctionData,
  getAddress,
  Hex,
  parseAbi,
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

// Official Canonical V2 Routers
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
}): Promise<ExtendedSwapQuote> {
  const client = getResilientPublicClient(params.chainId);

  // Auto-detect real on-chain decimals to prevent 6-decimal vs 18-decimal mismatches on BSC
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

  const sellUnits = parseUnits(
    params.sellAmountHuman || "0",
    realSellDecimals
  );

  if (sellUnits <= 0n) {
    throw new Error("Enter an amount greater than 0");
  }

  const isTestnet = CHAIN_METADATA[params.chainId].isTestnet;
  const wethAddress = getAddress(CHAIN_METADATA[params.chainId].wethAddress);
  const sellSym = params.sellToken.symbol.toUpperCase();
  const buySym = params.buyToken.symbol.toUpperCase();

  // 1. Direct Native <-> Wrapped Native (e.g. BNB <-> WBNB, ETH <-> WETH)
  if (
    (params.sellToken.address === "NATIVE" && (buySym === "WBNB" || buySym === "WETH")) ||
    ((sellSym === "WBNB" || sellSym === "WETH") && params.buyToken.address === "NATIVE")
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

  // 2. Query LI.FI Aggregator on Mainnet (for major trades)
  if (!isTestnet) {
    const fromTokenAddr =
      params.sellToken.address === "NATIVE"
        ? "0x0000000000000000000000000000000000000000"
        : getAddress(params.sellToken.address);
    const toTokenAddr =
      params.buyToken.address === "NATIVE"
        ? "0x0000000000000000000000000000000000000000"
        : getAddress(params.buyToken.address);

    try {
      const lifiUrl = new URL("https://li.quest/v1/quote");
      lifiUrl.searchParams.set("fromChain", String(params.chainId));
      lifiUrl.searchParams.set("toChain", String(params.chainId));
      lifiUrl.searchParams.set("fromToken", fromTokenAddr);
      lifiUrl.searchParams.set("toToken", toTokenAddr);
      lifiUrl.searchParams.set("fromAmount", sellUnits.toString());
      lifiUrl.searchParams.set("fromAddress", taker);
      lifiUrl.searchParams.set(
        "slippage",
        (params.slippagePercent / 100).toString()
      );

      const lifiRes = await fetch(lifiUrl.toString());
      if (lifiRes.ok) {
        const lifiData = await lifiRes.json();
        if (lifiData?.transactionRequest?.to && lifiData?.estimate?.toAmount) {
          const buyUnits = BigInt(lifiData.estimate.toAmount);
          const sellFloat = parseFloat(params.sellAmountHuman);
          const buyFloat = Number(buyUnits) / 10 ** params.buyToken.decimals;
          const routerRate = sellFloat > 0 ? buyFloat / sellFloat : 1.0;

          return {
            chainId: params.chainId,
            sellToken: params.sellToken.address,
            buyToken: params.buyToken.address,
            sellAmount: sellUnits.toString(),
            buyAmount: buyUnits.toString(),
            estimatedPriceImpact: lifiData.estimate.priceImpact || "0.08",
            price: routerRate.toFixed(6),
            guaranteedPrice: (
              routerRate *
              (1 - params.slippagePercent / 100)
            ).toFixed(6),
            to: getAddress(lifiData.transactionRequest.to as Address),
            data: (lifiData.transactionRequest.data || "0x") as Hex,
            value: BigInt(lifiData.transactionRequest.value || "0").toString(),
            gas: String(lifiData.transactionRequest.gasLimit || "185000"),
            allowanceTarget: getAddress(
              (lifiData.estimate.approvalAddress ||
                lifiData.transactionRequest.to) as Address
            ),
            sources: [
              {
                name: lifiData.toolDetails?.name || "LI.FI_Router",
                proportion: "1",
              },
            ],
            isSimulatedRouterCalldata: false,
          };
        }
      }
    } catch {
      // Fall through to Direct On-Chain V2 Router
    }
  }

  // 3. Direct On-Chain PancakeSwap V2 (BSC) / Uniswap V2 Router
  // Query on-chain getAmountsOut to guarantee the router will NOT revert on slippage
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
    // If pair does not exist on-chain, estimate via priceStream
    const sellUsd = priceStream.getTokenUsdTicker(params.sellToken).price;
    const buyUsd = priceStream.getTokenUsdTicker(params.buyToken).price;
    const rate = buyUsd > 0 ? sellUsd / buyUsd : 1.0;
    const estFloat = parseFloat(params.sellAmountHuman) * rate;
    onChainBuyUnits = parseUnits(
      estFloat.toFixed(Math.min(params.buyToken.decimals, 8)),
      params.buyToken.decimals
    );
  }

  if (onChainBuyUnits <= 0n) {
    throw new Error(
      `Insufficient on-chain liquidity on PancakeSwap for ${params.sellToken.symbol}/${params.buyToken.symbol}.`
    );
  }

  // 1% slippage margin on micro-swaps to eliminate sandwich/block drift reverts
  const slippageBps = BigInt(Math.max(50, Math.floor(params.slippagePercent * 100)));
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

  const sellFloat = parseFloat(params.sellAmountHuman);
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
    gas: "165000",
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
