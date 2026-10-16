type PriceTicker = {
  price: number;
  change24h: number;
};

type PriceSubscriber = (prices: Record<string, PriceTicker>) => void;

class RealtimePriceStream {
  private ws: WebSocket | null = null;
  private subscribers = new Set<PriceSubscriber>();
  private cache: Record<string, PriceTicker> = {
    ETHUSDT: { price: 2640.5, change24h: 2.85 },
    USDCUSDT: { price: 1.0, change24h: 0.01 },
    LINKUSDT: { price: 14.8, change24h: 4.12 },
    UNIUSDT: { price: 8.45, change24h: -1.15 },
    MATICUSDT: { price: 0.52, change24h: 1.4 },
    BNBUSDT: { price: 595.0, change24h: 0.92 },
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

  private connectWebSocket() {
    try {
      const streams = [
        "ethusdt@ticker",
        "bnbusdt@ticker",
        "maticusdt@ticker",
        "linkusdt@ticker",
        "uniusdt@ticker",
      ].join("/");

      this.ws = new WebSocket(
        `wss://stream.binance.com:9443/stream?streams=${streams}`
      );

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const data = payload?.data;
          if (data && data.s && data.c) {
            this.cache[data.s] = {
              price: parseFloat(data.c),
              change24h: parseFloat(data.P || "0"),
            };
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

  // Throttled to max 1 UI render dispatch every 800ms for 60fps performance
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
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin,matic-network,chainlink,uniswap&vs_currencies=usd&include_24hr_change=true"
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
      // Retain last cached prices on offline state
    }
  }
}

export const priceStream = new RealtimePriceStream();
