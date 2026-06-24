import axios from 'axios';

interface PriceCache {
  usd: number;
  timestamp: number;
}

export class PriceFetcher {
  private cache: Map<number, PriceCache> = new Map();
  private cacheTtlMs = 300_000; // 5 minutes
  private lastRequestTime = 0;
  private readonly minRequestIntervalMs = 1000; // 1 second between requests (max 60 req/min)

  // CoinGecko IDs per chainId
  private readonly coinIds: Record<number, string> = {
    1: 'ethereum',
    56: 'binancecoin',
    137: 'matic-network',
    10: 'ethereum',
    42161: 'ethereum',
    43114: 'avalanche-2',
  };

  async getUsdPrice(chainId: number): Promise<number> {
    const cached = this.cache.get(chainId);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.usd;
    }

    const coinId = this.coinIds[chainId];
    if (!coinId) return 0;

    // Rate limiting: wait if last request was too recent
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestIntervalMs - timeSinceLastRequest));
    }

    try {
      this.lastRequestTime = Date.now();
      const { data } = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      const price = data[coinId]?.usd;
      if (price && price > 0) {
        this.cache.set(chainId, { usd: price, timestamp: Date.now() });
        return price;
      }
    } catch (err: any) {
      // Log rate limit errors specifically
      if (err?.response?.status === 429) {
        console.warn(`[PriceFetcher] CoinGecko rate limited, will use cached price`);
      }
      // Fallback to expired cache
      const expired = this.cache.get(chainId);
      if (expired) return expired.usd;
    }

    return this.getFallbackPrice(chainId);
  }

  private getFallbackPrice(chainId: number): number {
    // After fix: return 0 instead of hardcoded prices
    // Hardcoded prices become stale and cause incorrect USD calculations
    // Returning 0 will filter out transactions with unknown prices
    console.warn(`[PriceFetcher] No price available for chain ${chainId}, returning 0`);
    return 0;
  }
}
