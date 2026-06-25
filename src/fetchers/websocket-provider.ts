import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { config, ChainConfig } from '../config';

// Network presets for WebSocketProvider (prevents network detection retry)
const NETWORK_PRESETS: Record<number, ethers.Network> = {
  1: new ethers.Network('mainnet', 1),
  56: new ethers.Network('bsc-mainnet', 56),
  137: new ethers.Network('polygon-mainnet', 137),
  10: new ethers.Network('optimism-mainnet', 10),
  42161: new ethers.Network('arbitrum-mainnet', 42161),
  43114: new ethers.Network('avalanche-mainnet', 43114),
};

export interface BlockEvent {
  chainId: number;
  chainName: string;
  blockNumber: number;
  timestamp: number;
  transactionCount: number;
}

export interface TransactionEvent {
  chainId: number;
  chainName: string;
  hash: string;
  from: string;
  to: string;
  value: bigint;
  blockNumber: number;
  timestamp: number;
}

export class WebSocketProvider extends EventEmitter {
  private providers: Map<number, ethers.WebSocketProvider> = new Map();
  private reconnectAttempts: Map<number, number> = new Map();
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;
  private pollIntervals: Map<number, NodeJS.Timeout> = new Map();

  constructor() {
    super();
    this.initProviders();
  }

  private initProviders(): void {
    for (const chain of config.chains) {
      const wsUrl = this.getWsUrl(chain);
      if (wsUrl) {
        this.createProvider(chain, wsUrl);
      }
    }
  }

  private getWsUrl(chain: ChainConfig): string | null {
    const envKey = this.getWsEnvKey(chain.chainId);
    const wsUrl = process.env[envKey];
    if (wsUrl) return wsUrl;

    // Fallback: Convert HTTP RPC to WebSocket if possible
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

  private createProvider(chain: ChainConfig, wsUrl: string): void {
    try {
      const networkPreset = NETWORK_PRESETS[chain.chainId] || new ethers.Network('unknown', chain.chainId);
      const provider = new ethers.WebSocketProvider(wsUrl, networkPreset, { staticNetwork: networkPreset });
      this.providers.set(chain.chainId, provider);
      this.reconnectAttempts.set(chain.chainId, 0);

      this.setupEventListeners(chain, provider);
      console.log(`[WebSocket] Connected to ${chain.name}`);
    } catch (err: any) {
      console.warn(`[WebSocket] Failed to connect to ${chain.name}:`, err.message);
    }
  }

  private setupEventListeners(chain: ChainConfig, provider: ethers.WebSocketProvider): void {
    provider.on('block', async (blockNumber) => {
      try {
        const block = await provider.getBlock(blockNumber);
        if (block) {
          const blockEvent: BlockEvent = {
            chainId: chain.chainId,
            chainName: chain.name,
            blockNumber,
            timestamp: block.timestamp * 1000,
            transactionCount: block.transactions.length,
          };
          this.emit('block', blockEvent);

          // Process each transaction in the block
          for (const txHash of block.transactions) {
            const tx = await provider.getTransaction(txHash);
            if (tx && tx.value > 0n) {
              const txEvent: TransactionEvent = {
                chainId: chain.chainId,
                chainName: chain.name,
                hash: tx.hash,
                from: tx.from.toLowerCase(),
                to: (tx.to || '').toLowerCase(),
                value: tx.value,
                blockNumber,
                timestamp: block.timestamp * 1000,
              };
              this.emit('transaction', txEvent);
            }
          }
        }
        this.reconnectAttempts.set(chain.chainId, 0);
      } catch (err: any) {
        console.warn(`[WebSocket] Error processing block on ${chain.name}:`, err.message);
      }
    });

    provider.on('error', (err) => {
      console.error(`[WebSocket] Error on ${chain.name}:`, err.message);
      this.handleReconnect(chain);
    });
  }

  private handleReconnect(chain: ChainConfig): void {
    const attempts = this.reconnectAttempts.get(chain.chainId) || 0;
    if (attempts >= this.maxReconnectAttempts) {
      console.error(`[WebSocket] Max reconnect attempts reached for ${chain.name}`);
      return;
    }

    this.reconnectAttempts.set(chain.chainId, attempts + 1);
    const delay = this.reconnectDelayMs * Math.pow(2, attempts);

    console.log(`[WebSocket] Reconnecting to ${chain.name} in ${delay}ms (attempt ${attempts + 1})`);

    setTimeout(() => {
      const wsUrl = this.getWsUrl(chain);
      if (wsUrl) {
        this.createProvider(chain, wsUrl);
      }
    }, delay);
  }

  async getLatestBlock(chainId: number): Promise<BlockEvent | null> {
    const provider = this.providers.get(chainId);
    if (!provider) return null;

    try {
      const blockNumber = await provider.getBlockNumber();
      const block = await provider.getBlock(blockNumber);
      const chain = config.chains.find(c => c.chainId === chainId);

      if (block && chain) {
        return {
          chainId,
          chainName: chain.name,
          blockNumber,
          timestamp: block.timestamp * 1000,
          transactionCount: block.transactions.length,
        };
      }
    } catch (err: any) {
      console.warn(`[WebSocket] Error getting latest block for ${chainId}:`, err.message);
    }

    return null;
  }

  async getTransaction(chainId: number, txHash: string): Promise<ethers.TransactionResponse | null> {
    const provider = this.providers.get(chainId);
    if (!provider) return null;

    try {
      return await provider.getTransaction(txHash);
    } catch {
      return null;
    }
  }

  isConnected(chainId: number): boolean {
    const provider = this.providers.get(chainId);
    return provider !== undefined;
  }

  getConnectedChains(): number[] {
    return Array.from(this.providers.keys());
  }

  async disconnect(): Promise<void> {
    for (const [chainId, provider] of this.providers) {
      try {
        await provider.destroy();
      } catch {
        // Ignore errors
      }
    }
    this.providers.clear();

    for (const interval of this.pollIntervals.values()) {
      clearInterval(interval);
    }
    this.pollIntervals.clear();

    console.log('[WebSocket] All providers disconnected');
  }
}
