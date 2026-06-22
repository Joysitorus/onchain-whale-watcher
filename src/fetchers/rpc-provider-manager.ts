import { ethers } from 'ethers';

interface ProviderConfig {
  url: string;
  name: string;
  weight?: number; // Priority weight (lower = higher priority)
}

interface ProviderHealth {
  url: string;
  name: string;
  successCount: number;
  failCount: number;
  lastFailTime: number;
  lastSuccessTime: number;
  cooldownUntil: number; // Timestamp when provider can be used again
  avgResponseTime: number;
}

interface ChainProviderPool {
  chainId: number;
  providers: ProviderConfig[];
  health: Map<string, ProviderHealth>;
  currentIndex: number;
  lastResetDate: string; // Track last reset date (YYYY-MM-DD)
}

interface WsProviderPool {
  chainId: number;
  urls: WsProviderConfig[];
  health: Map<string, ProviderHealth>;
  currentIndex: number;
}

interface WsProviderConfig {
  url: string;
  name: string;
  weight?: number;
}

export class RpcProviderManager {
  private pools: Map<number, ChainProviderPool> = new Map();
  private wsPools: Map<number, WsProviderPool> = new Map();
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  
  // Rate limit cooldown: 60 seconds
  private static readonly RATE_LIMIT_COOLDOWN_MS = 60_000;
  // Failure cooldown: 30 seconds
  private static readonly FAILURE_COOLDOWN_MS = 30_000;
  // Max failures before cooldown
  private static readonly MAX_FAILURES_BEFORE_COOLDOWN = 3;
  // Health decay period: 5 minutes
  private static readonly HEALTH_DECAY_MS = 300_000;

  constructor() {
    this.initializePools();
  }

  private initializePools(): void {
    const chainIds = (process.env.MONITORED_CHAINS || '1').split(',').map(Number);
    
    for (const chainId of chainIds) {
      // Initialize HTTP RPC pool
      const providers = this.buildProviderList(chainId);
      if (providers.length > 0) {
        const pool: ChainProviderPool = {
          chainId,
          providers,
          health: new Map(),
          currentIndex: 0,
          lastResetDate: this.getCurrentDate(),
        };

        for (const provider of providers) {
          pool.health.set(provider.url, {
            url: provider.url,
            name: provider.name,
            successCount: 0,
            failCount: 0,
            lastFailTime: 0,
            lastSuccessTime: 0,
            cooldownUntil: 0,
            avgResponseTime: 1000,
          });
        }

        this.pools.set(chainId, pool);
      }

      // Initialize WebSocket pool
      const wsUrls = this.buildWsUrlList(chainId);
      if (wsUrls.length > 0) {
        const wsPool: WsProviderPool = {
          chainId,
          urls: wsUrls,
          health: new Map(),
          currentIndex: 0,
        };

        for (const ws of wsUrls) {
          wsPool.health.set(ws.url, {
            url: ws.url,
            name: ws.name,
            successCount: 0,
            failCount: 0,
            lastFailTime: 0,
            lastSuccessTime: 0,
            cooldownUntil: 0,
            avgResponseTime: 1000,
          });
        }

        this.wsPools.set(chainId, wsPool);
      }
    }
  }

  private getCurrentDate(): string {
    // Returns YYYY-MM-DD in local timezone
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private checkDailyReset(pool: ChainProviderPool): void {
    const today = this.getCurrentDate();
    
    if (pool.lastResetDate !== today) {
      console.log(`[RPC Provider] Daily reset: ${pool.lastResetDate} → ${today} (chain ${pool.chainId})`);
      
      // Reset index to first provider (Infura Key #1)
      pool.currentIndex = 0;
      pool.lastResetDate = today;
      
      // Clear all cooldowns and reset health
      for (const [url, health] of pool.health) {
        health.cooldownUntil = 0;
        health.failCount = 0;
        health.successCount = 0;
      }
      
      // Clear cached providers to force new connections
      this.clearCacheForChain(pool.chainId);
    }
  }

  private clearCacheForChain(chainId: number): void {
    const keysToDelete: string[] = [];
    for (const key of this.providers.keys()) {
      if (key.startsWith(`${chainId}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.providers.delete(key);
    }
  }

  private buildProviderList(chainId: number): ProviderConfig[] {
    const providers: ProviderConfig[] = [];
    
    // Build Infura URLs from individual keys
    const infuraKeys = this.getInfuraKeys();
    const infuraNetwork = this.getInfuraNetwork(chainId);
    
    if (infuraNetwork) {
      for (let i = 0; i < infuraKeys.length; i++) {
        const key = infuraKeys[i];
        providers.push({
          url: `https://${infuraNetwork}.infura.io/v3/${key}`,
          name: `Infura-${i + 1}`,
          weight: i, // First key has highest priority
        });
      }
    }

    // Add fallback public RPCs
    const fallbacks = this.getFallbackRpcUrls(chainId);
    providers.push(...fallbacks);

    return providers;
  }

  private getInfuraKeys(): string[] {
    const keys: string[] = [];
    
    // Check for multiple Infura keys (INFURA_KEY_1, INFURA_KEY_2, etc.)
    for (let i = 1; i <= 10; i++) {
      const key = process.env[`INFURA_KEY_${i}`];
      if (key) keys.push(key);
    }
    
    // Fallback to single INFURA_KEY
    if (keys.length === 0 && process.env.INFURA_KEY) {
      keys.push(process.env.INFURA_KEY);
    }
    
    return keys;
  }

  private getInfuraNetwork(chainId: number): string | null {
    // Infura does NOT support BSC - only use for supported chains
    const networkMap: Record<number, string> = {
      1: 'mainnet',           // Ethereum
      137: 'polygon-mainnet', // Polygon
      10: 'optimism-mainnet', // Optimism
      42161: 'arbitrum-mainnet', // Arbitrum
      43114: 'avalanche-mainnet', // Avalanche
    };
    return networkMap[chainId] || null;
  }

  private getFallbackRpcUrls(chainId: number): ProviderConfig[] {
    const fallbacks: ProviderConfig[] = [];
    
    // Check for custom fallback URLs in env
    const envKey = `${this.getChainName(chainId)}_RPC_FALLBACKS`;
    const customFallbacks = process.env[envKey];
    
    if (customFallbacks) {
      const urls = customFallbacks.split(',').map(u => u.trim()).filter(Boolean);
      urls.forEach((url, i) => {
        fallbacks.push({
          url,
          name: `Fallback-${i + 1}`,
          weight: 100 + i, // Lower priority than Infura
        });
      });
    }

    // Add default public RPCs as last resort
    const defaultPublic = this.getDefaultPublicRpcs(chainId);
    fallbacks.push(...defaultPublic);

    return fallbacks;
  }

  private getDefaultPublicRpcs(chainId: number): ProviderConfig[] {
    const publicRpcs: Record<number, ProviderConfig[]> = {
      1: [
        { url: 'https://rpc.ankr.com/eth', name: 'Ankr-ETH', weight: 200 },
        { url: 'https://eth.llamarpc.com', name: 'LlamaRPC-ETH', weight: 201 },
        { url: 'https://cloudflare-eth.com', name: 'Cloudflare-ETH', weight: 202 },
      ],
      56: [
        { url: 'https://bsc-dataseed.binance.org/', name: 'Binance-BSC', weight: 200 },
        { url: 'https://rpc.ankr.com/bsc', name: 'Ankr-BSC', weight: 201 },
      ],
      137: [
        { url: 'https://polygon-rpc.com', name: 'Polygon-RPC', weight: 200 },
        { url: 'https://rpc.ankr.com/polygon', name: 'Ankr-Polygon', weight: 201 },
      ],
      10: [
        { url: 'https://mainnet.optimism.io', name: 'OP-Foundation', weight: 200 },
        { url: 'https://rpc.ankr.com/optimism', name: 'Ankr-OP', weight: 201 },
      ],
      42161: [
        { url: 'https://arb1.arbitrum.io/rpc', name: 'Arbitrum-One', weight: 200 },
        { url: 'https://rpc.ankr.com/arbitrum', name: 'Ankr-Arb', weight: 201 },
      ],
      43114: [
        { url: 'https://api.avax.network/ext/bc/C/rpc', name: 'Avalanche-C', weight: 200 },
        { url: 'https://rpc.ankr.com/avalanche', name: 'Ankr-AVAX', weight: 201 },
      ],
    };
    
    return publicRpcs[chainId] || [];
  }

  // ==================== WebSocket URL Rotation ====================

  private buildWsUrlList(chainId: number): WsProviderConfig[] {
    const urls: WsProviderConfig[] = [];

    // Check for custom WS URLs from env vars (per-chain)
    const envWsUrl = this.getWsUrlFromEnv(chainId);
    if (envWsUrl) {
      urls.push({ url: envWsUrl, name: 'Env-WS', weight: 0 });
      // Still add fallbacks in case env var URL fails
    }

    // Build WS URLs from Infura keys (only for supported chains)
    const infuraKeys = this.getInfuraKeys();
    const infuraNetwork = this.getInfuraWsNetwork(chainId);

    if (infuraNetwork) {
      for (let i = 0; i < infuraKeys.length; i++) {
        const key = infuraKeys[i];
        urls.push({
          url: `wss://${infuraNetwork}.infura.io/ws/v3/${key}`,
          name: `Infura-WS-${i + 1}`,
          weight: 10 + i,
        });
      }
    }

    // Add fallback public WebSocket endpoints
    const fallbacks = this.getDefaultPublicWsUrls(chainId);
    urls.push(...fallbacks);

    return urls;
  }

  private getWsUrlFromEnv(chainId: number): string | null {
    const envKeys: Record<number, string[]> = {
      1: ['ETH_WS_URL'],
      56: ['BSC_WS_URL'],
      137: ['POLYGON_WS_URL'],
      10: ['OPTIMISM_WS_URL'],
      42161: ['ARBITRUM_WS_URL'],
      43114: ['AVALANCHE_WS_URL'],
    };
    const keys = envKeys[chainId] || [];
    for (const key of keys) {
      if (process.env[key]) return process.env[key]!;
    }
    return null;
  }

  private getInfuraWsNetwork(chainId: number): string | null {
    // Infura does NOT support BSC - only use for supported chains
    const networkMap: Record<number, string> = {
      1: 'mainnet',           // Ethereum
      137: 'polygon-mainnet', // Polygon
      10: 'optimism-mainnet', // Optimism
      42161: 'arbitrum-mainnet', // Arbitrum
      43114: 'avalanche-mainnet', // Avalanche
    };
    return networkMap[chainId] || null;
  }

  private getDefaultPublicWsUrls(chainId: number): WsProviderConfig[] {
    // Most public RPCs don't support WebSocket, so only add known ones
    const publicWs: Record<number, WsProviderConfig[]> = {
      1: [
        { url: 'wss://eth.llamarpc.com', name: 'LlamaRPC-WS-ETH', weight: 200 },
        { url: 'wss://rpc.ankr.com/eth/ws', name: 'Ankr-WS-ETH', weight: 201 },
      ],
      56: [
        { url: 'wss://bsc-ws.nariox.org:443', name: 'Nariox-WS-BSC', weight: 200 },
      ],
      137: [],
      10: [],
      42161: [],
      43114: [],
    };
    return publicWs[chainId] || [];
  }

  /**
   * Get the next available WebSocket URL with rotation and cooldown.
   * Returns null if all providers are in cooldown.
   */
  getWsUrl(chainId: number): string | null {
    const pool = this.wsPools.get(chainId);
    if (!pool || pool.urls.length === 0) return null;

    const now = Date.now();

    for (let attempts = 0; attempts < pool.urls.length; attempts++) {
      const idx = (pool.currentIndex + attempts) % pool.urls.length;
      const config = pool.urls[idx];
      const health = pool.health.get(config.url);

      if (!health) continue;

      // Skip if in cooldown
      if (health.cooldownUntil > now) {
        continue;
      }

      // Skip if too many failures
      if (health.failCount >= RpcProviderManager.MAX_FAILURES_BEFORE_COOLDOWN) {
        health.cooldownUntil = now + RpcProviderManager.FAILURE_COOLDOWN_MS;
        health.failCount = 0;
        continue;
      }

      // Found a healthy provider - advance index for next call
      pool.currentIndex = (idx + 1) % pool.urls.length;
      return config.url;
    }

    return null; // All providers in cooldown
  }

  /**
   * Get the name of a WS provider by its URL.
   */
  getWsProviderName(chainId: number, wsUrl: string): string {
    const pool = this.wsPools.get(chainId);
    if (!pool) return 'Unknown';
    const config = pool.urls.find(u => u.url === wsUrl);
    return config?.name || 'Unknown';
  }

  reportWsSuccess(chainId: number, wsUrl: string, responseTimeMs: number = 0): void {
    const pool = this.wsPools.get(chainId);
    if (!pool) return;

    const health = pool.health.get(wsUrl);
    if (!health) return;

    health.successCount++;
    health.lastSuccessTime = Date.now();
    health.failCount = Math.max(0, health.failCount - 1);
    health.avgResponseTime = health.avgResponseTime * 0.7 + responseTimeMs * 0.3;
  }

  reportWsFailure(chainId: number, wsUrl: string, isRateLimit: boolean = false): void {
    const pool = this.wsPools.get(chainId);
    if (!pool) return;

    const health = pool.health.get(wsUrl);
    if (!health) return;

    health.failCount++;
    health.lastFailTime = Date.now();

    if (isRateLimit) {
      health.cooldownUntil = Date.now() + RpcProviderManager.RATE_LIMIT_COOLDOWN_MS;
      console.warn(`[WS Provider] Rate limited on ${health.name} (chain ${chainId}), cooldown ${RpcProviderManager.RATE_LIMIT_COOLDOWN_MS / 1000}s`);
    } else if (health.failCount >= RpcProviderManager.MAX_FAILURES_BEFORE_COOLDOWN) {
      health.cooldownUntil = Date.now() + RpcProviderManager.FAILURE_COOLDOWN_MS;
      console.warn(`[WS Provider] ${health.name} (chain ${chainId}) failed ${health.failCount} times, cooldown ${RpcProviderManager.FAILURE_COOLDOWN_MS / 1000}s`);
    }
  }

  isWsRateLimitError(error: any): boolean {
    const message = error?.message?.toLowerCase() || '';
    return (
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('unexpected server response: 429')
    );
  }

  private getChainName(chainId: number): string {
    const names: Record<number, string> = {
      1: 'ETH',
      56: 'BSC',
      137: 'POLYGON',
      10: 'OPTIMISM',
      42161: 'ARBITRUM',
      43114: 'AVALANCHE',
    };
    return names[chainId] || 'UNKNOWN';
  }

  async getProvider(chainId: number): Promise<ethers.JsonRpcProvider | null> {
    const pool = this.pools.get(chainId);
    if (!pool || pool.providers.length === 0) return null;

    // Check for daily reset (new day = credits refreshed)
    this.checkDailyReset(pool);

    const now = Date.now();
    
    // Try each provider in order, skipping those in cooldown
    for (let attempts = 0; attempts < pool.providers.length; attempts++) {
      const providerConfig = this.getNextHealthyProvider(pool, now);
      if (!providerConfig) break;

      const cacheKey = `${chainId}:${providerConfig.url}`;
      
      // Return cached provider if available and healthy
      if (this.providers.has(cacheKey)) {
        return this.providers.get(cacheKey)!;
      }

      // Create new provider
      const provider = new ethers.JsonRpcProvider(providerConfig.url);
      this.providers.set(cacheKey, provider);
      
      return provider;
    }

    return null;
  }

  private getNextHealthyProvider(pool: ChainProviderPool, now: number): ProviderConfig | null {
    // Find next provider that's not in cooldown
    for (let i = 0; i < pool.providers.length; i++) {
      const idx = (pool.currentIndex + i) % pool.providers.length;
      const config = pool.providers[idx];
      const health = pool.health.get(config.url);

      if (!health) continue;

      // Check if in cooldown
      if (health.cooldownUntil > now) {
        continue;
      }

      // Check failure rate
      if (health.failCount >= RpcProviderManager.MAX_FAILURES_BEFORE_COOLDOWN) {
        // Apply cooldown
        health.cooldownUntil = now + RpcProviderManager.FAILURE_COOLDOWN_MS;
        health.failCount = 0; // Reset after cooldown
        continue;
      }

      // This provider is healthy enough to try
      pool.currentIndex = (idx + 1) % pool.providers.length;
      return config;
    }

    return null;
  }

  reportSuccess(chainId: number, providerUrl: string, responseTimeMs: number): void {
    const pool = this.pools.get(chainId);
    if (!pool) return;

    const health = pool.health.get(providerUrl);
    if (!health) return;

    health.successCount++;
    health.lastSuccessTime = Date.now();
    health.failCount = Math.max(0, health.failCount - 1); // Reduce failure count on success
    
    // Update average response time (exponential moving average)
    health.avgResponseTime = health.avgResponseTime * 0.7 + responseTimeMs * 0.3;
  }

  reportFailure(chainId: number, providerUrl: string, isRateLimit: boolean = false): void {
    const pool = this.pools.get(chainId);
    if (!pool) return;

    const health = pool.health.get(providerUrl);
    if (!health) return;

    health.failCount++;
    health.lastFailTime = Date.now();

    if (isRateLimit) {
      // Rate limited - apply longer cooldown
      health.cooldownUntil = Date.now() + RpcProviderManager.RATE_LIMIT_COOLDOWN_MS;
      console.warn(`[RPC Provider] Rate limited on ${health.name} (${chainId}), cooldown ${RpcProviderManager.RATE_LIMIT_COOLDOWN_MS / 1000}s`);
    } else if (health.failCount >= RpcProviderManager.MAX_FAILURES_BEFORE_COOLDOWN) {
      health.cooldownUntil = Date.now() + RpcProviderManager.FAILURE_COOLDOWN_MS;
      console.warn(`[RPC Provider] ${health.name} (${chainId}) failed ${health.failCount} times, cooldown ${RpcProviderManager.FAILURE_COOLDOWN_MS / 1000}s`);
    }
  }

  isRateLimitError(error: any): boolean {
    const message = error?.message?.toLowerCase() || '';
    return (
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('too many requests') ||
      message.includes('daily request limit') ||
      message.includes('credits') ||
      message.includes('quota exceeded')
    );
  }

  getStatus(): Array<{
    chainId: number;
    providers: Array<{
      name: string;
      url: string;
      successCount: number;
      failCount: number;
      inCooldown: boolean;
      avgResponseTime: number;
    }>;
    wsProviders?: Array<{
      name: string;
      url: string;
      successCount: number;
      failCount: number;
      inCooldown: boolean;
      avgResponseTime: number;
    }>;
  }> {
    const status: Array<{
      chainId: number;
      providers: Array<{
        name: string;
        url: string;
        successCount: number;
        failCount: number;
        inCooldown: boolean;
        avgResponseTime: number;
      }>;
      wsProviders?: Array<{
        name: string;
        url: string;
        successCount: number;
        failCount: number;
        inCooldown: boolean;
        avgResponseTime: number;
      }>;
    }> = [];

    const now = Date.now();

    for (const [chainId, pool] of this.pools) {
      const providers = pool.providers.map(config => {
        const health = pool.health.get(config.url)!;
        return {
          name: health.name,
          url: this.maskUrl(health.url),
          successCount: health.successCount,
          failCount: health.failCount,
          inCooldown: health.cooldownUntil > now,
          avgResponseTime: Math.round(health.avgResponseTime),
        };
      });

      const entry: any = { chainId, providers };

      // Add WS provider status if available
      const wsPool = this.wsPools.get(chainId);
      if (wsPool) {
        entry.wsProviders = wsPool.urls.map(config => {
          const health = wsPool.health.get(config.url)!;
          return {
            name: health.name,
            url: this.maskUrl(health.url),
            successCount: health.successCount,
            failCount: health.failCount,
            inCooldown: health.cooldownUntil > now,
            avgResponseTime: Math.round(health.avgResponseTime),
          };
        });
      }

      status.push(entry);
    }

    return status;
  }

  private maskUrl(url: string): string {
    // Mask API keys in URLs for logging
    return url.replace(/\/v3\/[a-zA-Z0-9]+/, '/v3/***')
              .replace(/\/v2\/[a-zA-Z0-9]+/, '/v2/***');
  }

  clearCache(): void {
    this.providers.clear();
  }
}

// Singleton instance
export const rpcProviderManager = new RpcProviderManager();
