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
  
  // Exponential backoff on 429 rate limits
  private rateLimitCooldownUntil = 0; // Timestamp when we can retry after 429
  private rateLimitBackoffMs = 0; // Current backoff duration
  private static readonly INITIAL_BACKOFF_MS = 30_000; // Start with 30s cooldown
  private static readonly MAX_BACKOFF_MS = 300_000; // Max 5 minutes cooldown

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
   * Fetch USD price for any token by CoinGecko ID (with caching + rate limiting + exponential backoff)
   */
  async getTokenPriceByCoinId(coingeckoId: string): Promise<number> {
    if (!coingeckoId) return 0;

    const cached = this.cache.get(coingeckoId);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.usd;
    }

    // If we're in rate limit cooldown, return cached value or 0 without hitting API
    if (this.rateLimitCooldownUntil > Date.now()) {
      const expired = this.cache.get(coingeckoId);
      return expired ? expired.usd : 0;
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
        // Reset backoff on success
        this.rateLimitBackoffMs = 0;
        return price;
      }
    } catch (err: any) {
      if (err?.response?.status === 429) {
        // Exponential backoff: 30s → 60s → 120s → 300s (max)
        if (this.rateLimitBackoffMs === 0) {
          this.rateLimitBackoffMs = PriceFetcher.INITIAL_BACKOFF_MS;
        } else {
          this.rateLimitBackoffMs = Math.min(this.rateLimitBackoffMs * 2, PriceFetcher.MAX_BACKOFF_MS);
        }
        this.rateLimitCooldownUntil = Date.now() + this.rateLimitBackoffMs;
        console.warn(`[PriceFetcher] CoinGecko rate limited! Backoff ${(this.rateLimitBackoffMs / 1000).toFixed(0)}s until ${new Date(this.rateLimitCooldownUntil).toISOString()}`);
      }
      // Fallback to expired cache
      const expired = this.cache.get(coingeckoId);
      if (expired) return expired.usd;
    }

    // Only log warning for non-rate-limited misses
    if (this.rateLimitCooldownUntil <= Date.now()) {
      console.warn(`[PriceFetcher] No price available for ${coingeckoId}, returning 0`);
    }
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
