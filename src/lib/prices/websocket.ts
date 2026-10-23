import { TokenAsset } from "@/types/wallet";

export type PriceTicker = {
  price: number;
  change24h: number;
};

type PriceSubscriber = (prices: Record<string, PriceTicker>) => void;

const STABLECOIN_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "FDUSD",
  "USDE",
  "BUSD",
]);

const FALLBACK_SYMBOL_USD: Record<string, PriceTicker> = {
  BTC: { price: 67420.5, change24h: 2.34 },
  WBTC: { price: 67420.5, change24h: 2.34 },
  ETH: { price: 2465.82, change24h: 1.45 },
  WETH: { price: 2465.82, change24h: 1.45 },
  SOL: { price: 178.65, change24h: 4.18 },
  QIE: { price: 0.0485, change24h: 6.42 },
  USDC: { price: 1.0, change24h: 0.0 },
  USDT: { price: 1.0, change24h: 0.0 },
  DAI: { price: 1.0, change24h: 0.0 },
  EURC: { price: 1.08, change24h: 0.12 },
  LINK: { price: 14.8, change24h: 2.4 },
  UNI: { price: 8.45, change24h: -0.95 },
  AAVE: { price: 148.0, change24h: 2.8 },
  LDO: { price: 1.85, change24h: -0.5 },
  ARB: { price: 0.82, change24h: 1.1 },
  OP: { price: 1.65, change24h: 1.9 },
  POL: { price: 0.52, change24h: 1.2 },
  MATIC: { price: 0.52, change24h: 1.2 },
  BNB: { price: 595.0, change24h: 0.85 },
  PEPE: { price: 0.00001, change24h: 4.2 },
  AERO: { price: 1.15, change24h: 3.1 },
};

class RealtimePriceStream {
  private ws: WebSocket | null = null;
  private subscribers = new Set<PriceSubscriber>();
  private cache: Record<string, PriceTicker> = {
    BTCUSDT: { price: 67420.5, change24h: 2.34 },
    ETHUSDT: { price: 2465.82, change24h: 1.45 },
    SOLUSDT: { price: 178.65, change24h: 4.18 },
    QIEUSDT: { price: 0.0485, change24h: 6.42 },
    USDCUSDT: { price: 1.0, change24h: 0.0 },
    USDTUSDT: { price: 1.0, change24h: 0.0 },
    LINKUSDT: { price: 14.8, change24h: 2.4 },
    UNIUSDT: { price: 8.45, change24h: -0.95 },
    MATICUSDT: { price: 0.52, change24h: 1.2 },
    BNBUSDT: { price: 595.0, change24h: 0.85 },
    WBTCUSDT: { price: 67420.5, change24h: 2.34 },
    AAVEUSDT: { price: 148.0, change24h: 2.8 },
    ARBUSDT: { price: 0.82, change24h: 1.1 },
    OPUSDT: { price: 1.65, change24h: 1.9 },
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

  public getTokenUsdTicker(
    token: Pick<TokenAsset, "symbol" | "binanceSymbol">,
    liveMap?: Record<string, PriceTicker>
  ): PriceTicker {
    const source = liveMap || this.cache;
    const sym = token.symbol.toUpperCase();

    if (STABLECOIN_SYMBOLS.has(sym)) {
      return { price: 1.0, change24h: 0.0 };
    }
    if (sym === "BTC" || sym === "WBTC") {
      return source.BTCUSDT || FALLBACK_SYMBOL_USD.BTC;
    }
    if (sym === "SOL") {
      return source.SOLUSDT || FALLBACK_SYMBOL_USD.SOL;
    }
    if (sym === "QIE") {
      return source.QIEUSDT || FALLBACK_SYMBOL_USD.QIE;
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
        "btcusdt@ticker",
        "ethusdt@ticker",
        "solusdt@ticker",
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
            if (baseSym === "BTC") {
              FALLBACK_SYMBOL_USD.WBTC = {
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
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,matic-network,chainlink,uniswap&vs_currencies=usd&include_24hr_change=true"
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.bitcoin) {
        this.cache.BTCUSDT = {
          price: json.bitcoin.usd,
          change24h: json.bitcoin.usd_24h_change || 0,
        };
      }
      if (json.ethereum) {
        this.cache.ETHUSDT = {
          price: json.ethereum.usd,
          change24h: json.ethereum.usd_24h_change || 0,
        };
      }
      if (json.solana) {
        this.cache.SOLUSDT = {
          price: json.solana.usd,
          change24h: json.solana.usd_24h_change || 0,
        };
      }
      this.scheduleThrottledEmit();
    } catch {
      // Retain cached prices when offline
    }
  }
}

export const priceStream = new RealtimePriceStream();
