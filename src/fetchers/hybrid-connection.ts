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
      console.log(`[Hybrid] WebSocket rotation enabled with ${config.infuraKeys.length} Infura keys`);
    }

    for (const chain of config.chains) {
      if (!chain.rpcUrl) {
        console.warn(`[${chain.name}] No RPC URL configured, skipping`);
        continue;
      }

      // Init HTTP provider (always needed for polling fallback)
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.chainId, provider);

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

      // Try WebSocket if enabled
      if (config.enableWebSocket) {
        const wsUrl = this.getNextWsUrl(chain.chainId);
        if (wsUrl) {
          await this.connectWebSocket(chain, wsUrl);
        }
      }

      // Always start polling as fallback
      this.startPolling(chain);
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
      const wsProvider = new ethers.WebSocketProvider(wsUrl);
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
          health.lastBlockNumber = blockNumber;
          health.lastUpdate = Date.now();
          health.errorCount = 0;

          // Fetch full block data
          const block = await wsProvider.getBlock(blockNumber);
          if (block) {
            this.emit('block', {
              chainId: chain.chainId,
              chainName: chain.name,
              blockNumber,
              timestamp: block.timestamp * 1000,
              transactionCount: block.transactions.length,
            });

            // Emit transaction events for value transfers
            for (const txHash of block.transactions) {
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
            }
          }
        } catch (err: any) {
          console.warn(`[WS] Error processing block on ${chain.name}:`, err.message);
        }
      });

      // Handle WebSocket errors (post-connection)
      wsProvider.on('error', (err) => {
        console.error(`[WS] Error on ${chain.name}:`, err.message);

        // Report failure to provider manager
        if (this.useProviderManager) {
          const isRateLimit = rpcProviderManager.isWsRateLimitError(err);
          const currentUrl = this.currentWsUrls.get(chain.chainId);
          if (currentUrl) {
            rpcProviderManager.reportWsFailure(chain.chainId, currentUrl, isRateLimit);
          }
        }

        this.handleWebSocketDisconnect(chain);
      });

      const providerName = this.useProviderManager
        ? rpcProviderManager.getWsProviderName(chain.chainId, wsUrl)
        : 'Direct';
      console.log(`[WS] Connected to ${chain.name} via ${providerName}`);

    } catch (err: any) {
      console.warn(`[WS] Failed to connect to ${chain.name}: ${err.message}`);

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
      try {
        const provider = this.providers.get(chain.chainId);
        if (!provider) return;

        const health = this.health.get(chain.chainId)!;
        const blockNumber = await provider.getBlockNumber();

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
        console.warn(`[Poll] Error on ${chain.name}:`, err.message);
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
    const provider = this.providers.get(chainId);
    if (!provider) return null;

    try {
      return await provider.getBlock('latest');
    } catch {
      return null;
    }
  }

  async getTransaction(chainId: number, txHash: string) {
    const provider = this.providers.get(chainId);
    if (!provider) return null;

    try {
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

    console.log('[Hybrid] All connections stopped');
  }
}
