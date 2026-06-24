import axios from 'axios';

interface PriceCache {
  usd: number;
  timestamp: number;
}

export class PriceFetcher {
  private cache: Map<string, PriceCache> = new Map();
  private cacheTtlMs = 300_000; // 5 minutes
  private lastRequestTime = 0;
  private readonly minRequestIntervalMs = 1000; // 1 second between requests (max 60 req/min)

  // CoinGecko IDs per chainId (native coins)
  private readonly nativeCoinIds: Record<number, string> = {
    1: 'ethereum',
    56: 'binancecoin',
    137: 'matic-network',
    10: 'ethereum',
    42161: 'ethereum',
    43114: 'avalanche-2',
  };

  private async rateLimitAndWait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestIntervalMs - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetch USD price for any token by CoinGecko ID (with caching + rate limiting)
   */
  async getTokenPriceByCoinId(coingeckoId: string): Promise<number> {
    if (!coingeckoId) return 0;

    const cached = this.cache.get(coingeckoId);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.usd;
    }

    await this.rateLimitAndWait();

    try {
      const { data } = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      const price = data[coingeckoId]?.usd;
      if (price && price > 0) {
        this.cache.set(coingeckoId, { usd: price, timestamp: Date.now() });
        return price;
      }
    } catch (err: any) {
      if (err?.response?.status === 429) {
        console.warn(`[PriceFetcher] CoinGecko rate limited for ${coingeckoId}`);
      }
      // Fallback to expired cache
      const expired = this.cache.get(coingeckoId);
      if (expired) return expired.usd;
    }

    console.warn(`[PriceFetcher] No price available for ${coingeckoId}, returning 0`);
    return 0;
  }

  /**
   * Fetch USD price for native coin by chainId (with caching + rate limiting)
   */
  async getUsdPrice(chainId: number): Promise<number> {
    const coinId = this.nativeCoinIds[chainId];
    if (!coinId) return 0;
    return this.getTokenPriceByCoinId(coinId);
  }
}
