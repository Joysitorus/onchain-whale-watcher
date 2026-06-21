import axios from 'axios';

interface PriceCache {
  usd: number;
  timestamp: number;
}

export class PriceFetcher {
  private cache: Map<number, PriceCache> = new Map();
  private cacheTtlMs = 300_000; // 5 menit

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

    try {
      const { data } = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      const price = data[coinId]?.usd;
      if (price && price > 0) {
        this.cache.set(chainId, { usd: price, timestamp: Date.now() });
        return price;
      }
    } catch {
      // fallback ke cache expired atau harga default
      const expired = this.cache.get(chainId);
      if (expired) return expired.usd;
    }

    return this.getFallbackPrice(chainId);
  }

  private getFallbackPrice(chainId: number): number {
    const fallbacks: Record<number, number> = {
      1: 3500,
      56: 600,
      137: 0.7,
      10: 3500,
      42161: 3500,
      43114: 35,
    };
    return fallbacks[chainId] || 0;
  }
}
