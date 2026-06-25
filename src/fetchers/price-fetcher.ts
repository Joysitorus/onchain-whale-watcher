import axios from 'axios';

interface PriceCache {
  usd: number;
  timestamp: number;
}

export class PriceFetcher {
  private cache: Map<string, PriceCache> = new Map();
  private cacheTtlMs = 300_000; // 5 minutes
  private lastRequestTime = 0;
  private readonly minRequestIntervalMs = 1500; // 1.5 seconds between requests (was 1s, increased to reduce 429s)
  
  // Exponential backoff on 429 rate limits
  private rateLimitCooldownUntil = 0; // Timestamp when we can retry after 429
  private rateLimitBackoffMs = 0; // Current backoff duration
  private static readonly INITIAL_BACKOFF_MS = 60_000; // Start with 60s cooldown (was 30s)
  private static readonly MAX_BACKOFF_MS = 600_000; // Max 10 minutes cooldown (was 5min)

  // CoinGecko IDs per chainId (native coins)
  // Note: MATIC on Ethereum uses 'matic-network', but CoinGecko may not return prices
  // for non-native tokens. Use a fallback ID if primary fails.
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

  /**
   * Batch fetch USD prices for multiple CoinGecko IDs in one API call.
   * Returns a Map of coingeckoId → priceUsd.
   */
  async getTokenPricesByCoinIds(coingeckoIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const uncachedIds: string[] = [];

    // Check cache first
    for (const id of coingeckoIds) {
      if (!id) continue;
      const cached = this.cache.get(id);
      if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
        result.set(id, cached.usd);
      } else {
        uncachedIds.push(id);
      }
    }

    // If all cached, return immediately
    if (uncachedIds.length === 0) return result;

    // If in rate limit cooldown, return cached values
    if (this.rateLimitCooldownUntil > Date.now()) {
      for (const id of uncachedIds) {
        const expired = this.cache.get(id);
        result.set(id, expired ? expired.usd : 0);
      }
      return result;
    }

    await this.rateLimitAndWait();

    try {
      // CoinGecko supports up to 250 IDs per request
      const idsParam = [...new Set(uncachedIds)].join(',');
      const { data } = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=usd`,
        { timeout: 10000 }
      );
      
      for (const id of uncachedIds) {
        const price = data[id]?.usd;
        if (price && price > 0) {
          this.cache.set(id, { usd: price, timestamp: Date.now() });
          result.set(id, price);
        } else {
          result.set(id, 0);
        }
      }
      
      // Reset backoff on success
      this.rateLimitBackoffMs = 0;
    } catch (err: any) {
      if (err?.response?.status === 429) {
        if (this.rateLimitBackoffMs === 0) {
          this.rateLimitBackoffMs = PriceFetcher.INITIAL_BACKOFF_MS;
        } else {
          this.rateLimitBackoffMs = Math.min(this.rateLimitBackoffMs * 2, PriceFetcher.MAX_BACKOFF_MS);
        }
        this.rateLimitCooldownUntil = Date.now() + this.rateLimitBackoffMs;
        console.warn(`[PriceFetcher] CoinGecko rate limited! Backoff ${(this.rateLimitBackoffMs / 1000).toFixed(0)}s until ${new Date(this.rateLimitCooldownUntil).toISOString()}`);
      }
      // Return cached values on error
      for (const id of uncachedIds) {
        const expired = this.cache.get(id);
        result.set(id, expired ? expired.usd : 0);
      }
    }

    return result;
  }
}
