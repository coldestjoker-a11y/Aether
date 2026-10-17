import { TokenAsset } from "@/types/wallet";

export type PriceTicker = {
  price: number;
  change24h: number;
};

type PriceSubscriber = (prices: Record<string, PriceTicker>) => void;

const STABLECOIN_SYMBOLS = new Set(["USDC", "USDT", "DAI", "FDUSD", "USDE", "BUSD"]);

const FALLBACK_SYMBOL_USD: Record<string, PriceTicker> = {
  ETH: { price: 2640.5, change24h: 2.85 },
  WETH: { price: 2640.5, change24h: 2.85 },
  USDC: { price: 1.0, change24h: 0.0 },
  USDT: { price: 1.0, change24h: 0.0 },
  DAI: { price: 1.0, change24h: 0.0 },
  EURC: { price: 1.08, change24h: 0.15 },
  LINK: { price: 14.8, change24h: 4.12 },
  UNI: { price: 8.45, change24h: -1.15 },
  WBTC: { price: 64200.0, change24h: 1.95 },
  AAVE: { price: 148.0, change24h: 3.1 },
  LDO: { price: 1.85, change24h: -0.8 },
  ARB: { price: 0.82, change24h: 1.25 },
  OP: { price: 1.65, change24h: 2.1 },
  POL: { price: 0.52, change24h: 1.4 },
  MATIC: { price: 0.52, change24h: 1.4 },
  BNB: { price: 595.0, change24h: 0.92 },
  PEPE: { price: 0.00001, change24h: 5.4 },
  AERO: { price: 1.15, change24h: 3.8 },
};

class RealtimePriceStream {
  private ws: WebSocket | null = null;
  private subscribers = new Set<PriceSubscriber>();
  private cache: Record<string, PriceTicker> = {
    ETHUSDT: { price: 2640.5, change24h: 2.85 },
    USDCUSDT: { price: 1.0, change24h: 0.0 },
    LINKUSDT: { price: 14.8, change24h: 4.12 },
    UNIUSDT: { price: 8.45, change24h: -1.15 },
    MATICUSDT: { price: 0.52, change24h: 1.4 },
    BNBUSDT: { price: 595.0, change24h: 0.92 },
    WBTCUSDT: { price: 64200.0, change24h: 1.95 },
    AAVEUSDT: { price: 148.0, change24h: 3.1 },
    ARBUSDT: { price: 0.82, change24h: 1.25 },
    OPUSDT: { price: 1.65, change24h: 2.1 },
  };
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  public subscribe(callback: PriceSubscriber): () => void {
    this.subscribers.add(callback);
    callback({ ...this.cache });

    if (!this.ws && typeof window !== "undefined") {
      this.connectWebSocket();
    }

    return () => {
      this.subscribers.delete(callback);
      if (this.subscribers.size === 0 && this.ws) {
        this.ws.close();
        this.ws = null;
      }
    };
  }

  /**
   * Single source of truth for token USD price across both Dashboard and Swap Aggregator.
   * Ensures swapping $20 of Token A to Token B always equals $20 on the Dashboard.
   */
  public getTokenUsdTicker(
    token: Pick<TokenAsset, "symbol" | "binanceSymbol">,
    liveMap?: Record<string, PriceTicker>
  ): PriceTicker {
    const source = liveMap || this.cache;
    const sym = token.symbol.toUpperCase();

    if (STABLECOIN_SYMBOLS.has(sym)) {
      return { price: 1.0, change24h: 0.0 };
    }
    if (sym === "WETH" || sym === "ETH") {
      return source.ETHUSDT || FALLBACK_SYMBOL_USD.ETH;
    }
    if (token.binanceSymbol && source[token.binanceSymbol]) {
      return source[token.binanceSymbol];
    }
    if (source[`${sym}USDT`]) {
      return source[`${sym}USDT`];
    }
    if (FALLBACK_SYMBOL_USD[sym]) {
      return FALLBACK_SYMBOL_USD[sym];
    }
    return { price: 1.0, change24h: 0.0 };
  }

  private connectWebSocket() {
    try {
      const streams = [
        "ethusdt@ticker",
        "bnbusdt@ticker",
        "maticusdt@ticker",
        "linkusdt@ticker",
        "uniusdt@ticker",
        "wbtcusdt@ticker",
        "aaveusdt@ticker",
        "arbusdt@ticker",
        "opusdt@ticker",
      ].join("/");

      this.ws = new WebSocket(
        `wss://stream.binance.com:9443/stream?streams=${streams}`
      );

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const data = payload?.data;
          if (data && data.s && data.c) {
            const parsedPrice = parseFloat(data.c);
            const parsedChange = parseFloat(data.P || "0");
            this.cache[data.s] = {
              price: parsedPrice,
              change24h: parsedChange,
            };
            const baseSym = data.s.replace(/USDT$/, "");
            FALLBACK_SYMBOL_USD[baseSym] = {
              price: parsedPrice,
              change24h: parsedChange,
            };
            if (baseSym === "ETH") {
              FALLBACK_SYMBOL_USD.WETH = {
                price: parsedPrice,
                change24h: parsedChange,
              };
            }
            this.scheduleThrottledEmit();
          }
        } catch {
          // Ignore malformed WS frames
        }
      };

      this.ws.onerror = () => {
        this.fetchCoinGeckoFallback();
      };
    } catch {
      this.fetchCoinGeckoFallback();
    }
  }

  private scheduleThrottledEmit() {
    if (this.throttleTimer) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      const snapshot = { ...this.cache };
      this.subscribers.forEach((sub) => sub(snapshot));
    }, 800);
  }

  private async fetchCoinGeckoFallback() {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin,matic-network,chainlink,uniswap,wrapped-bitcoin,aave,arbitrum,optimism&vs_currencies=usd&include_24hr_change=true"
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.ethereum) {
        this.cache.ETHUSDT = {
          price: json.ethereum.usd,
          change24h: json.ethereum.usd_24h_change || 0,
        };
      }
      this.scheduleThrottledEmit();
    } catch {
      // Retain cached prices when offline
    }
  }
}

export const priceStream = new RealtimePriceStream();
