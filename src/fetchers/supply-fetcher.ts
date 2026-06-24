import axios from 'axios';

interface SupplyCache {
  totalSupply: number;
  circulatingSupply: number;
  totalUsd: number;
  timestamp: number;
}

export class SupplyFetcher {
  private cache: Map<string, SupplyCache> = new Map();
  private cacheTtlMs = 3_600_000; // 1 hour
  // P3-4: Rate limiting - 1 second between CoinGecko requests
  private lastRequestTime = 0;
  private readonly minRequestIntervalMs = 1000;

  // CoinGecko IDs per chain native token
  private readonly nativeCoinIds: Record<number, string> = {
    1: 'ethereum',
    56: 'binancecoin',
    137: 'matic-network',
    10: 'ethereum',
    42161: 'ethereum',
    43114: 'avalanche-2',
  };

  // Common token addresses for ERC-20 tokens (mainnet)
  private readonly tokenAddresses: Record<string, { address: string; chainId: number }> = {
    'USDT': { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', chainId: 1 },
    'USDC': { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 1 },
    'WBTC': { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1 },
    'DAI': { address: '0x6b175474e89094c44da98b954eedeac495271d0f', chainId: 1 },
    'SHIB': { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', chainId: 1 },
    'PEPE': { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chainId: 1 },
    'ARB': { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', chainId: 42161 },
    'OP': { address: '0x4200000000000000000000000000000000000042', chainId: 10 },
  };

  private async rateLimitAndWait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestIntervalMs - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  async getNativeTokenSupply(chainId: number): Promise<{ total: number; circulating: number; totalUsd: number } | null> {
    const coinId = this.nativeCoinIds[chainId];
    if (!coinId) return null;

    const cacheKey = `native_${chainId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return { total: cached.totalSupply, circulating: cached.circulatingSupply, totalUsd: cached.totalUsd };
    }

    try {
      // P3-4: Rate limit before CoinGecko request
      await this.rateLimitAndWait();
      const { data } = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`,
        { timeout: 5000 }
      );

      const totalSupply = data.market_data?.total_supply || 0;
      const circulatingSupply = data.market_data?.circulating_supply || 0;
      const marketCap = data.market_data?.market_cap?.usd || 0;

      if (totalSupply > 0) {
        this.cache.set(cacheKey, {
          totalSupply,
          circulatingSupply,
          totalUsd: marketCap,
          timestamp: Date.now(),
        });
        return { total: totalSupply, circulating: circulatingSupply, totalUsd: marketCap };
      }
    } catch {
      // Fallback to cached or null
    }

    return null;
  }

  async getTokenSupply(tokenSymbol: string, chainId: number = 1): Promise<{ total: number; circulating: number; totalUsd: number } | null> {
    const cacheKey = `token_${tokenSymbol}_${chainId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return { total: cached.totalSupply, circulating: cached.circulatingSupply, totalUsd: cached.totalUsd };
    }

    // Try CoinGecko search for the token
    try {
      // P3-4: Rate limit before CoinGecko request
      await this.rateLimitAndWait();
      const { data: searchData } = await axios.get(
        `https://api.coingecko.com/api/v3/search?query=${tokenSymbol}`,
        { timeout: 5000 }
      );

      const coin = searchData.coins?.find((c: any) =>
        c.symbol.toLowerCase() === tokenSymbol.toLowerCase()
      );

      if (coin) {
        // P3-4: Rate limit before second CoinGecko request
        await this.rateLimitAndWait();
        const { data } = await axios.get(
          `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&community_data=false&developer_data=false`,
          { timeout: 5000 }
        );

        const totalSupply = data.market_data?.total_supply || 0;
        const circulatingSupply = data.market_data?.circulating_supply || 0;
        const marketCap = data.market_data?.market_cap?.usd || 0;

        if (totalSupply > 0) {
          this.cache.set(cacheKey, {
            totalSupply,
            circulatingSupply,
            totalUsd: marketCap,
            timestamp: Date.now(),
          });
          return { total: totalSupply, circulating: circulatingSupply, totalUsd: marketCap };
        }
      }
    } catch {
      // Fallback
    }

    return null;
  }

  calculateSupplyPercentage(holdingsUsd: number, tokenPrice: number, totalSupply: number): number {
    if (totalSupply <= 0 || tokenPrice <= 0) return 0;
    const tokensHeld = holdingsUsd / tokenPrice;
    return (tokensHeld / totalSupply) * 100;
  }

  getAccumulationSignal(percentage: number, previousPercentage: number): {
    signal: 'accumulating' | 'distributing' | 'stable';
    changePercent: number;
  } {
    const change = percentage - previousPercentage;
    const threshold = 0.01; // 0.01% change threshold

    if (change > threshold) {
      return { signal: 'accumulating', changePercent: change };
    } else if (change < -threshold) {
      return { signal: 'distributing', changePercent: change };
    }
    return { signal: 'stable', changePercent: 0 };
  }
}
