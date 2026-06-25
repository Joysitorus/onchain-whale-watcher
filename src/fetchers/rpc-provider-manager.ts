import { ethers } from 'ethers';

/**
 * StableJsonRpcProvider - Custom provider that prevents the "failed to detect network" retry spam.
 * Uses ethers.js v6's built-in staticNetwork option to completely disable eth_chainId detection.
 */
export class StableJsonRpcProvider extends ethers.JsonRpcProvider {
  constructor(url: string, network: ethers.Networkish) {
    // Pass staticNetwork option to prevent network detection retry loop
    // This tells ethers to NEVER call eth_chainId, avoiding the infinite retry
    super(url, network, { staticNetwork: ethers.Network.from(network) });
  }
}

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
    this.logChainKeyDistribution();
  }

  private logChainKeyDistribution(): void {
    const infuraKeys = this.getInfuraKeys();
    console.log('[RPC Provider] Chain-Key Distribution Strategy:');
    console.log('================================================');
    
    // Log key assignments based on getInfuraKeyIndexForChain
    const keyAssignments: Record<number, string[]> = {};
    for (const [chainId] of this.pools) {
      const keyIndex = this.getInfuraKeyIndexForChain(chainId);
      if (keyIndex >= 0) {
        if (!keyAssignments[keyIndex]) keyAssignments[keyIndex] = [];
        keyAssignments[keyIndex].push(this.getChainName(chainId));
      }
    }
    
    for (let keyIndex = 0; keyIndex < infuraKeys.length; keyIndex++) {
      const chains = keyAssignments[keyIndex] || [];
      if (chains.length > 0) {
        console.log(`  Infura Key ${keyIndex + 1}: ${chains.join(', ')}`);
      }
    }
    
    // Check for BSC (no Infura)
    if (this.pools.has(56)) {
      console.log(`  BSC: Uses public RPCs only (Infura not supported)`);
    }
    
    console.log('================================================');
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

  /**
   * Get the assigned Infura key index for a specific chain.
   * Each key handles only 2 chains to reduce burst requests:
   * - Key 1: Ethereum (1), Polygon (137)
   * - Key 2: Arbitrum (42161), Avalanche (43114)
   * - Key 3: Optimism (10)
   * 
   * Note: Key 2 doesn't have Optimism access, so Optimism moved to Key 3.
   * Returns -1 if the chain doesn't use Infura (e.g., BSC).
   */
  private getInfuraKeyIndexForChain(chainId: number): number {
    // BSC is not supported by Infura - uses public RPCs only
    if (chainId === 56) return -1;

    // Chain-to-key assignment mapping
    // Each key handles 2 chains max to reduce burst
    // Key 2 doesn't have Optimism network access, so Optimism uses Key 3
    const chainKeyMap: Record<number, number> = {
      1: 0,     // Ethereum → Key 1
      137: 0,   // Polygon → Key 1
      42161: 1, // Arbitrum → Key 2
      43114: 1, // Avalanche → Key 2
      10: 2,    // Optimism → Key 3
    };

    return chainKeyMap[chainId] ?? -1;
  }

  private buildProviderList(chainId: number): ProviderConfig[] {
    const providers: ProviderConfig[] = [];
    
    // Build Infura URLs - only the assigned key for this chain
    const infuraKeys = this.getInfuraKeys();
    const infuraNetwork = this.getInfuraNetwork(chainId);
    const assignedKeyIndex = this.getInfuraKeyIndexForChain(chainId);
    
    if (infuraNetwork && assignedKeyIndex >= 0 && assignedKeyIndex < infuraKeys.length) {
      const key = infuraKeys[assignedKeyIndex];
      providers.push({
        url: `https://${infuraNetwork}.infura.io/v3/${key}`,
        name: `Infura-${assignedKeyIndex + 1}`,
        weight: 0,
      });
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
        { url: 'https://ethereum-rpc.publicnode.com', name: 'PublicNode-ETH', weight: 200 },
        { url: 'https://1rpc.io/eth', name: '1RPC-ETH', weight: 201 },
        { url: 'https://eth.drpc.org', name: 'Drpc-ETH', weight: 202 },
      ],
      56: [
        { url: 'https://bsc-rpc.publicnode.com', name: 'PublicNode-BSC', weight: 200 },
        { url: 'https://1rpc.io/bsc', name: '1RPC-BSC', weight: 201 },
      ],
      137: [
        { url: 'https://polygon-bor-rpc.publicnode.com', name: 'PublicNode-Polygon', weight: 200 },
        { url: 'https://1rpc.io/matic', name: '1RPC-Polygon', weight: 201 },
      ],
      10: [
        { url: 'https://optimism-rpc.publicnode.com', name: 'PublicNode-OP', weight: 200 },
        { url: 'https://1rpc.io/op', name: '1RPC-OP', weight: 201 },
      ],
      42161: [
        { url: 'https://arbitrum-one-rpc.publicnode.com', name: 'PublicNode-Arb', weight: 200 },
        { url: 'https://1rpc.io/arb', name: '1RPC-Arb', weight: 201 },
      ],
      43114: [
        { url: 'https://avalanche-c-chain-rpc.publicnode.com', name: 'PublicNode-AVAX', weight: 200 },
        { url: 'https://1rpc.io/avax/c-chain', name: '1RPC-AVAX', weight: 201 },
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

    // Build WS URLs from Infura keys - only the assigned key for this chain
    const infuraKeys = this.getInfuraKeys();
    const infuraNetwork = this.getInfuraWsNetwork(chainId);
    const assignedKeyIndex = this.getInfuraKeyIndexForChain(chainId);

    if (infuraNetwork && assignedKeyIndex >= 0 && assignedKeyIndex < infuraKeys.length) {
      const key = infuraKeys[assignedKeyIndex];
      urls.push({
        url: `wss://${infuraNetwork}.infura.io/ws/v3/${key}`,
        name: `Infura-WS-${assignedKeyIndex + 1}`,
        weight: 0,
      });
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
      const url = process.env[key];
      if (url) {
        // Skip invalid WS URLs: Infura does NOT support BSC
        // If env var points to an Infura BSC endpoint, skip it (it will return 429/404)
        if (chainId === 56 && url.includes('infura.io')) {
          console.warn(`[WS Provider] Skipping invalid BSC WS URL from env (Infura does not support BSC): ${key}`);
          return null;
        }
        // Skip placeholder values (e.g., "BSC_WS_URL" instead of actual URL)
        if (url === key || url.startsWith('wss://') === false) {
          console.warn(`[WS Provider] Skipping placeholder WS URL: ${key}=${url}`);
          return null;
        }
        return url;
      }
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
    // Public WebSocket endpoints (reliable free providers)
    const publicWs: Record<number, WsProviderConfig[]> = {
      1: [
        { url: 'wss://ethereum-rpc.publicnode.com', name: 'PublicNode-WS-ETH', weight: 200 },
      ],
      56: [
        { url: 'wss://bsc-rpc.publicnode.com', name: 'PublicNode-WS-BSC', weight: 200 },
      ],
      137: [
        { url: 'wss://polygon-bor-rpc.publicnode.com', name: 'PublicNode-WS-Polygon', weight: 200 },
      ],
      10: [
        { url: 'wss://optimism-rpc.publicnode.com', name: 'PublicNode-WS-OP', weight: 200 },
      ],
      42161: [
        { url: 'wss://arbitrum-one-rpc.publicnode.com', name: 'PublicNode-WS-Arb', weight: 200 },
      ],
      43114: [
        { url: 'wss://avalanche-c-chain-rpc.publicnode.com', name: 'PublicNode-WS-AVAX', weight: 200 },
      ],
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
      
      // Return cached provider if available
      if (this.providers.has(cacheKey)) {
        return this.providers.get(cacheKey)!;
      }

      // Create new provider with static network preset
      // This skips the eth_chainId detection call that causes "failed to detect network" spam
      // Using StableJsonRpcProvider to suppress the retry loop on failure
      const networkPreset = this.getNetworkPreset(chainId);
      const provider = new StableJsonRpcProvider(providerConfig.url, networkPreset);
      this.providers.set(cacheKey, provider);
      
      return provider;
    }

    return null;
  }

  private getNetworkPreset(chainId: number): ethers.Network {
    const networks: Record<number, ethers.Network> = {
      1: new ethers.Network('mainnet', 1),
      56: new ethers.Network('bsc-mainnet', 56),
      137: new ethers.Network('polygon-mainnet', 137),
      10: new ethers.Network('optimism-mainnet', 10),
      42161: new ethers.Network('arbitrum-mainnet', 42161),
      43114: new ethers.Network('avalanche-mainnet', 43114),
    };
    return networks[chainId] || new ethers.Network('unknown', chainId);
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

  reportAuthError(chainId: number, providerUrl: string): void {
    const pool = this.pools.get(chainId);
    if (!pool) return;

    const health = pool.health.get(providerUrl);
    if (!health) return;

    // Auth error means this provider won't work - apply very long cooldown
    health.failCount = RpcProviderManager.MAX_FAILURES_BEFORE_COOLDOWN;
    health.cooldownUntil = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    console.error(`[RPC Provider] Auth error on ${health.name} (${chainId}) - provider disabled for 24h (check API key access)`);
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

  isAuthError(error: any): boolean {
    const message = error?.message?.toLowerCase() || '';
    return (
      message.includes('401') ||
      message.includes('unauthorized') ||
      message.includes('project id does not have access')
    );
  }

  getStatus(): Array<{
    chainId: number;
    assignedInfuraKey: number;
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
      assignedInfuraKey: number;
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

      const entry: any = { 
        chainId, 
        assignedInfuraKey: this.getInfuraKeyIndexForChain(chainId) + 1, // 1-based for display
        providers 
      };

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
