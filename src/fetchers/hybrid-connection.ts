import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import WebSocket from 'ws';
import { config, ChainConfig } from '../config';
import { rpcProviderManager } from './rpc-provider-manager';

export interface TransactionData {
  hash: string;
  chainId: number;
  chainName: string;
  from: string;
  to: string;
  valueUsd: number;
  timestamp: number;
}

export type ConnectionMode = 'websocket' | 'polling' | 'hybrid';

export interface ChainHealth {
  chainId: number;
  mode: 'websocket' | 'polling';
  connected: boolean;
  lastBlockNumber: number;
  lastUpdate: number;
  errorCount: number;
  reconnectAttempts: number;
}

export class HybridConnectionManager extends EventEmitter {
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private wsProviders: Map<number, ethers.WebSocketProvider> = new Map();
  private currentWsUrls: Map<number, string> = new Map(); // Track current WS URL per chain
  private health: Map<number, ChainHealth> = new Map();
  private pollIntervals: Map<number, NodeJS.Timeout> = new Map();
  private pollIntervalMs: number;
  private wsReconnectAttempts: Map<number, number> = new Map();
  private maxWsReconnectAttempts = 10; // Increased: with rotation, more attempts across providers
  private mode: ConnectionMode;
  private useProviderManager: boolean;

  constructor() {
    super();
    this.pollIntervalMs = config.pollIntervalMs;
    this.mode = config.enableWebSocket ? 'hybrid' : 'polling';
    this.useProviderManager = config.rpcProviderRotation && config.infuraKeys.length > 1;
  }

  async start(): Promise<void> {
    console.log(`[Hybrid] Starting in ${this.mode} mode`);
    if (this.useProviderManager) {
      console.log(`[Hybrid] Provider rotation enabled with ${config.infuraKeys.length} Infura keys`);
    }

    // Start all polling immediately (no stagger needed - HTTP is resilient)
    for (const chain of config.chains) {
      if (!chain.rpcUrl) {
        console.warn(`[${chain.name}] No RPC URL configured, skipping`);
        continue;
      }

      // Init health tracking
      this.health.set(chain.chainId, {
        chainId: chain.chainId,
        mode: 'polling',
        connected: false,
        lastBlockNumber: 0,
        lastUpdate: 0,
        errorCount: 0,
        reconnectAttempts: 0,
      });

      // Always start polling as fallback
      this.startPolling(chain);
    }

    // Stagger WebSocket connections to avoid bursting all Infura keys simultaneously
    // Each WS pre-flight test takes ~1-2s, so 500ms stagger prevents overlap
    if (config.enableWebSocket) {
      for (let i = 0; i < config.chains.length; i++) {
        const chain = config.chains[i];
        if (!chain.rpcUrl) continue;

        if (i > 0) {
          // 500ms stagger between each chain's WS attempt
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        const wsUrl = this.getNextWsUrl(chain.chainId);
        if (wsUrl) {
          // Fire and forget - don't await, let it connect in background
          this.connectWebSocket(chain, wsUrl).catch(() => {});
        }
      }
    }
  }

  /**
   * Get the next available WebSocket URL from the provider manager.
   * Falls back to env var conversion if provider manager is not available.
   */
  private getNextWsUrl(chainId: number): string | null {
    if (this.useProviderManager) {
      return rpcProviderManager.getWsUrl(chainId);
    }

    // Fallback: use env var or convert HTTP to WS
    const chain = config.chains.find(c => c.chainId === chainId);
    if (!chain) return null;

    // Check env var first
    const envKeys: Record<number, string> = {
      1: 'ETH_WS_URL',
      56: 'BSC_WS_URL',
      137: 'POLYGON_WS_URL',
      10: 'OPTIMISM_WS_URL',
      42161: 'ARBITRUM_WS_URL',
      43114: 'AVALANCHE_WS_URL',
    };
    const envKey = envKeys[chainId];
    if (envKey && process.env[envKey]) return process.env[envKey]!;

    // Convert HTTP to WS
    if (chain.rpcUrl) {
      return chain.rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    }

    return null;
  }

  /**
   * Test WebSocket connection with raw ws library before creating ethers provider.
   * This catches HTTP 429 (rate limit) and other handshake errors early.
   */
  private testWebSocketConnection(wsUrl: string, timeoutMs: number = 10000): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.terminate();
        resolve({ ok: false, error: 'Connection timeout' });
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
        resolve({ ok: true });
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timer);
        // Extract HTTP status code from error message if present
        const msg = err.message || String(err);
        resolve({ ok: false, error: msg });
      });

      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        const statusCode = res?.statusCode || 0;
        ws.close();
        resolve({ ok: false, error: `Unexpected server response: ${statusCode}` });
      });
    });
  }

  private async connectWebSocket(chain: ChainConfig, wsUrl: string): Promise<void> {
    const health = this.health.get(chain.chainId)!;

    // Pre-flight check: test WS connection before creating ethers provider
    const test = await this.testWebSocketConnection(wsUrl);
    if (!test.ok) {
      console.warn(`[WS] Pre-flight check failed for ${chain.name} (${wsUrl.substring(0, 40)}...): ${test.error}`);
      health.mode = 'polling';

      // Report failure to provider manager
      if (this.useProviderManager) {
        const isRateLimit = rpcProviderManager.isWsRateLimitError({ message: test.error || '' });
        rpcProviderManager.reportWsFailure(chain.chainId, wsUrl, isRateLimit);
      }

      // Schedule retry with next provider
      this.scheduleReconnect(chain);
      return;
    }

    try {
      // IMPORTANT: Pre-open raw WS connection before creating ethers provider
      // This prevents ethers from creating its own connection that can race
      // and throw uncaught 429 errors before our error handler is attached
      const rawWs = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          rawWs.terminate();
          reject(new Error('WS open timeout'));
        }, 10000);
        rawWs.on('open', () => { clearTimeout(timer); resolve(); });
        rawWs.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
      });

      // Connection is now open - pass to ethers
      const wsProvider = new ethers.WebSocketProvider(rawWs as any);

      // IMPORTANT: Attach error handler IMMEDIATELY to prevent uncaught errors
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 5; // Lower threshold: disconnect faster

      wsProvider.on('error', (err) => {
        console.error(`[WS] Error on ${chain.name}: ${err.message?.substring(0, 100)}`);

        // Report failure to provider manager
        if (this.useProviderManager) {
          const isRateLimit = rpcProviderManager.isWsRateLimitError(err);
          const currentUrl = this.currentWsUrls.get(chain.chainId);
          if (currentUrl) {
            rpcProviderManager.reportWsFailure(chain.chainId, currentUrl, isRateLimit);
          }
        }

        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`[WS] Too many consecutive errors on ${chain.name} (${consecutiveErrors}), disconnecting`);
          this.handleWebSocketDisconnect(chain);
        }
      });

      // Now safe to continue setup
      this.wsProviders.set(chain.chainId, wsProvider);
      this.currentWsUrls.set(chain.chainId, wsUrl);
      this.wsReconnectAttempts.set(chain.chainId, 0);

      // Report success to provider manager
      if (this.useProviderManager) {
        rpcProviderManager.reportWsSuccess(chain.chainId, wsUrl);
      }

      health.mode = 'websocket';
      health.connected = true;

      // Listen for new blocks via WebSocket
      wsProvider.on('block', async (blockNumber) => {
        try {
          // Fetch full block data
          const block = await wsProvider.getBlock(blockNumber);
          if (block) {
            // Only reset consecutiveErrors ON SUCCESS (not at the start!)
            consecutiveErrors = 0;

            health.lastBlockNumber = blockNumber;
            health.lastUpdate = Date.now();
            health.errorCount = 0;

            this.emit('block', {
              chainId: chain.chainId,
              chainName: chain.name,
              blockNumber,
              timestamp: block.timestamp * 1000,
              transactionCount: block.transactions.length,
            });

            // Emit transaction events for value transfers
            for (const txHash of block.transactions) {
              try {
                const tx = await wsProvider.getTransaction(txHash);
                if (tx && tx.value > 0n) {
                  this.emit('transaction', {
                    chainId: chain.chainId,
                    chainName: chain.name,
                    hash: tx.hash,
                    from: tx.from.toLowerCase(),
                    to: (tx.to || '').toLowerCase(),
                    value: tx.value,
                    blockNumber,
                    timestamp: block.timestamp * 1000,
                  });
                }
              } catch {
                // Ignore individual tx errors (node might not have the tx yet)
              }
            }
          }
        } catch (err: any) {
          consecutiveErrors++;
          const errMsg = err.message?.substring(0, 100) || '';
          console.warn(`[WS] Error processing block on ${chain.name}: ${errMsg}`);

          // "internal error" means the node's subscription is broken - disconnect immediately
          const isFatal = errMsg.includes('internal error') || errMsg.includes('could not coalesce error');

          if (isFatal || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(`[WS] ${isFatal ? 'Fatal error' : 'Too many block errors'} on ${chain.name} (${consecutiveErrors}), disconnecting`);
            this.handleWebSocketDisconnect(chain);
          }
        }
      });

      const providerName = this.useProviderManager
        ? rpcProviderManager.getWsProviderName(chain.chainId, wsUrl)
        : 'Direct';
      console.log(`[WS] Connected to ${chain.name} via ${providerName}`);

    } catch (err: any) {
      console.warn(`[WS] Failed to connect to ${chain.name}: ${err.message?.substring(0, 100)}`);

      // Report failure to provider manager
      if (this.useProviderManager) {
        const isRateLimit = rpcProviderManager.isWsRateLimitError(err);
        rpcProviderManager.reportWsFailure(chain.chainId, wsUrl, isRateLimit);
      }

      health.mode = 'polling';
      this.scheduleReconnect(chain);
    }
  }

  private scheduleReconnect(chain: ChainConfig): void {
    const attempts = this.wsReconnectAttempts.get(chain.chainId) || 0;

    if (attempts >= this.maxWsReconnectAttempts) {
      console.error(`[WS] Max reconnect attempts reached for ${chain.name}, staying in polling mode`);
      return;
    }

    // Exponential backoff with jitter: ~5s, ~10s, ~20s, ~40s, ~80s (capped)
    const baseDelay = Math.min(5000 * Math.pow(2, attempts), 80000);
    const jitter = Math.floor(Math.random() * 1000);
    const delay = baseDelay + jitter;

    const providerName = this.useProviderManager ? 'next provider' : 'same URL';
    console.log(`[WS] Will retry ${chain.name} via ${providerName} in ${Math.round(delay / 1000)}s (attempt ${attempts + 1}/${this.maxWsReconnectAttempts})`);

    this.wsReconnectAttempts.set(chain.chainId, attempts + 1);

    setTimeout(async () => {
      const wsUrl = this.getNextWsUrl(chain.chainId);
      if (wsUrl) {
        await this.connectWebSocket(chain, wsUrl);
      } else {
        console.warn(`[WS] No available WS URLs for ${chain.name}, staying in polling mode`);
      }
    }, delay);
  }

  private handleWebSocketDisconnect(chain: ChainConfig): void {
    const health = this.health.get(chain.chainId)!;

    health.mode = 'polling';
    health.connected = false;
    health.errorCount++;

    this.wsProviders.delete(chain.chainId);
    this.currentWsUrls.delete(chain.chainId);

    this.scheduleReconnect(chain);
  }

  private startPolling(chain: ChainConfig): void {
    const poll = async () => {
      let provider: ethers.JsonRpcProvider | null = null;
      const startTime = Date.now();

      try {
        // Use rpcProviderManager for HTTP providers (with rotation)
        if (this.useProviderManager) {
          provider = await rpcProviderManager.getProvider(chain.chainId);
        } else {
          provider = this.providers.get(chain.chainId) || null;
        }
        if (!provider) return;

        const health = this.health.get(chain.chainId)!;
        const blockNumber = await provider.getBlockNumber();

        // Report success
        if (this.useProviderManager) {
          const responseTime = Date.now() - startTime;
          rpcProviderManager.reportSuccess(chain.chainId, provider._getConnection().url, responseTime);
        }

        // Only process if we got a new block (or if not using WS)
        if (health.mode === 'polling' || blockNumber > health.lastBlockNumber) {
          health.lastBlockNumber = blockNumber;
          health.lastUpdate = Date.now();
          health.connected = true;

          const block = await provider.getBlock(blockNumber);
          if (block) {
            this.emit('block', {
              chainId: chain.chainId,
              chainName: chain.name,
              blockNumber,
              timestamp: block.timestamp * 1000,
              transactionCount: block.transactions.length,
            });

            // Fetch transactions with value
            for (const txHash of block.transactions.slice(0, 10)) { // Limit to avoid rate limits
              const tx = await provider.getTransaction(txHash);
              if (tx && tx.value > 0n) {
                this.emit('transaction', {
                  chainId: chain.chainId,
                  chainName: chain.name,
                  hash: tx.hash,
                  from: tx.from.toLowerCase(),
                  to: (tx.to || '').toLowerCase(),
                  value: tx.value,
                  blockNumber,
                  timestamp: block.timestamp * 1000,
                });
              }
            }
          }
        }
      } catch (err: any) {
        // Report failure to provider manager
        if (this.useProviderManager && provider) {
          const isRateLimit = rpcProviderManager.isRateLimitError(err);
          rpcProviderManager.reportFailure(chain.chainId, provider._getConnection().url, isRateLimit);
        }

        console.warn(`[Poll] Error on ${chain.name}: ${err.message?.substring(0, 100)}`);
        const health = this.health.get(chain.chainId)!;
        health.errorCount++;
      }
    };

    // Start polling interval
    const interval = setInterval(poll, this.pollIntervalMs);
    this.pollIntervals.set(chain.chainId, interval);

    // Initial poll
    poll();
  }

  getHealthStatus(): ChainHealth[] {
    return Array.from(this.health.values());
  }

  isConnected(chainId: number): boolean {
    const health = this.health.get(chainId);
    return health?.connected || false;
  }

  getCurrentMode(chainId: number): 'websocket' | 'polling' {
    const health = this.health.get(chainId);
    return health?.mode || 'polling';
  }

  getConnectedChains(): number[] {
    return Array.from(this.health.values())
      .filter(h => h.connected)
      .map(h => h.chainId);
  }

  async getLatestBlock(chainId: number) {
    try {
      let provider: ethers.JsonRpcProvider | null = null;
      if (this.useProviderManager) {
        provider = await rpcProviderManager.getProvider(chainId);
      } else {
        provider = this.providers.get(chainId) || null;
      }
      if (!provider) return null;
      return await provider.getBlock('latest');
    } catch {
      return null;
    }
  }

  async getTransaction(chainId: number, txHash: string) {
    try {
      let provider: ethers.JsonRpcProvider | null = null;
      if (this.useProviderManager) {
        provider = await rpcProviderManager.getProvider(chainId);
      } else {
        provider = this.providers.get(chainId) || null;
      }
      if (!provider) return null;
      return await provider.getTransaction(txHash);
    } catch {
      return null;
    }
  }

  async stop(): Promise<void> {
    // Clear polling intervals
    for (const interval of this.pollIntervals.values()) {
      clearInterval(interval);
    }
    this.pollIntervals.clear();

    // Disconnect WebSocket providers
    for (const [chainId, wsProvider] of this.wsProviders) {
      try {
        await wsProvider.destroy();
      } catch {
        // Ignore
      }
    }
    this.wsProviders.clear();
    this.currentWsUrls.clear();

    // Clear RPC provider manager cache
    if (this.useProviderManager) {
      rpcProviderManager.clearCache();
    }

    console.log('[Hybrid] All connections stopped');
  }
}
