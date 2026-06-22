import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { config, ChainConfig } from '../config';

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
  private health: Map<number, ChainHealth> = new Map();
  private pollIntervals: Map<number, NodeJS.Timeout> = new Map();
  private pollIntervalMs: number;
  private wsReconnectAttempts: Map<number, number> = new Map();
  private maxWsReconnectAttempts = 5;
  private mode: ConnectionMode;

  constructor() {
    super();
    this.pollIntervalMs = config.pollIntervalMs;
    this.mode = config.enableWebSocket ? 'hybrid' : 'polling';
  }

  async start(): Promise<void> {
    console.log(`[Hybrid] Starting in ${this.mode} mode`);

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
        const wsUrl = this.getWsUrl(chain);
        if (wsUrl) {
          await this.connectWebSocket(chain, wsUrl);
        }
      }

      // Always start polling as fallback
      this.startPolling(chain);
    }
  }

  private getWsUrl(chain: ChainConfig): string | null {
    const envKey = this.getWsEnvKey(chain.chainId);
    const wsUrl = process.env[envKey];
    if (wsUrl) return wsUrl;

    // Fallback: Convert HTTP RPC to WebSocket
    if (chain.rpcUrl) {
      return chain.rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    }

    return null;
  }

  private getWsEnvKey(chainId: number): string {
    const keys: Record<number, string> = {
      1: 'ETH_WS_URL',
      56: 'BSC_WS_URL',
      137: 'POLYGON_WS_URL',
      10: 'OPTIMISM_WS_URL',
      42161: 'ARBITRUM_WS_URL',
      43114: 'AVALANCHE_WS_URL',
    };
    return keys[chainId] || `CHAIN_${chainId}_WS_URL`;
  }

  private async connectWebSocket(chain: ChainConfig, wsUrl: string): Promise<void> {
    try {
      const wsProvider = new ethers.WebSocketProvider(wsUrl);
      this.wsProviders.set(chain.chainId, wsProvider);
      this.wsReconnectAttempts.set(chain.chainId, 0);

      const health = this.health.get(chain.chainId)!;
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

      // Handle WebSocket errors
      wsProvider.on('error', (err) => {
        console.error(`[WS] Error on ${chain.name}:`, err.message);
        this.handleWebSocketDisconnect(chain);
      });

      console.log(`[WS] Connected to ${chain.name}`);

    } catch (err: any) {
      console.warn(`[WS] Failed to connect to ${chain.name}:`, err.message);
      this.health.get(chain.chainId)!.mode = 'polling';
    }
  }

  private handleWebSocketDisconnect(chain: ChainConfig): void {
    const health = this.health.get(chain.chainId)!;
    const attempts = this.wsReconnectAttempts.get(chain.chainId) || 0;

    health.mode = 'polling';
    health.connected = false;
    health.errorCount++;
    health.reconnectAttempts = attempts + 1;

    this.wsProviders.delete(chain.chainId);

    if (attempts >= this.maxWsReconnectAttempts) {
      console.error(`[WS] Max reconnect attempts reached for ${chain.name}, staying in polling mode`);
      return;
    }

    // Exponential backoff: 5s, 10s, 20s, 40s, 80s
    const delay = 5000 * Math.pow(2, attempts);
    console.log(`[WS] Reconnecting to ${chain.name} in ${delay}ms (attempt ${attempts + 1})`);

    setTimeout(async () => {
      const wsUrl = this.getWsUrl(chain);
      if (wsUrl) {
        this.wsReconnectAttempts.set(chain.chainId, attempts + 1);
        await this.connectWebSocket(chain, wsUrl);
      }
    }, delay);
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
