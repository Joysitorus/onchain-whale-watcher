import { ethers } from 'ethers';
import axios from 'axios';
import { config, ChainConfig } from '../config';
import { TokenRegistry, TRANSFER_TOPIC } from '../tokens/token-registry';
import { PriceFetcher } from './price-fetcher';
import { MonitoredTransfer, WhaleTokenPurchase } from '../types';
import { rpcProviderManager, StableJsonRpcProvider } from './rpc-provider-manager';
import { LabelDatabase } from '../label-db';
import { metrics } from '../metrics/metrics-service';

// Network presets for StableJsonRpcProvider (prevents network detection retry)
const NETWORK_PRESETS: Record<number, ethers.Network> = {
  1: new ethers.Network('mainnet', 1),
  56: new ethers.Network('bsc-mainnet', 56),
  137: new ethers.Network('polygon-mainnet', 137),
  10: new ethers.Network('optimism-mainnet', 10),
  42161: new ethers.Network('arbitrum-mainnet', 42161),
  43114: new ethers.Network('avalanche-mainnet', 43114),
};

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

export class TokenTransferFetcher {
  private legacyProviders: Map<number, ethers.JsonRpcProvider> = new Map();
  private priceFetcher = new PriceFetcher();
  private fetchBlockCache: Map<number, number> = new Map();
  private useProviderManager: boolean;

  constructor(private tokenRegistry: TokenRegistry, private labelDb?: LabelDatabase) {
    this.useProviderManager = config.rpcProviderRotation && config.infuraKeys.length > 1;

    if (!this.useProviderManager) {
      // Fallback: create own providers using StableJsonRpcProvider (only when rotation is disabled)
      for (const chain of config.chains) {
        if (chain.rpcUrl) {
          const networkPreset = NETWORK_PRESETS[chain.chainId] || new ethers.Network('unknown', chain.chainId);
          this.legacyProviders.set(chain.chainId, new StableJsonRpcProvider(chain.rpcUrl, networkPreset));
        }
      }
    }
  }

  private async getProvider(chainId: number): Promise<ethers.JsonRpcProvider | null> {
    if (this.useProviderManager) {
      return rpcProviderManager.getProvider(chainId);
    }
    return this.legacyProviders.get(chainId) || null;
  }

  /**
   * Validate Ethereum address format (0x + 40 hex chars)
   */
  private isValidEthAddress(address: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }

  async fetchTokenTransfers(
    chain: ChainConfig,
    fromBlock: number,
    toBlock: number,
    watchedAddresses?: string[]
  ): Promise<WhaleTokenPurchase[]> {
    const provider = await this.getProvider(chain.chainId);
    if (!provider) return [];

    const purchases: WhaleTokenPurchase[] = [];
    const addressesToWatch = watchedAddresses?.map(a => a.toLowerCase()) || [];

    // Get tokens for this chain
    const chainTokens = this.tokenRegistry.getTokensByChain(chain.chainId);
    
    // P3 priority: Only fetch top tokens by importance to avoid RPC rate limits
    // BSC PublicNode has strict eth_getLogs limits (-32005 "limit exceeded")
    const MAX_TOKENS_PER_CHAIN: Record<number, number> = {
      1: 50,    // Ethereum - large block range needs fewer tokens
      56: 15,   // BSC - strict rate limits on public RPCs
      137: 30,  // Polygon
      42161: 30, // Arbitrum
      43114: 20, // Avalanche
      10: 20,   // Optimism
    };
    const maxTokens = MAX_TOKENS_PER_CHAIN[chain.chainId] || 20;
    const tokensToFetch = chainTokens.slice(0, maxTokens);

    for (const tokenInfo of tokensToFetch) {
      // Validate address before making RPC call (prevents invalid address errors)
      if (!this.isValidEthAddress(tokenInfo.address)) {
        console.warn(`[TokenFetcher] Skipping invalid address for ${tokenInfo.symbol} on ${chain.name}: ${tokenInfo.address}`);
        continue;
      }

      try {
        const tokenPurchases = await this.fetchTokenTransfersForContract(
          chain,
          tokenInfo.address,
          fromBlock,
          toBlock,
          addressesToWatch
        );
        purchases.push(...tokenPurchases);
      } catch (err: any) {
        // Log failed token fetches for debugging
        console.warn(`[TokenFetcher] Failed to fetch transfers for ${tokenInfo.symbol} (${tokenInfo.address}) on ${chain.name}: ${err.message}`);
      }
    }

    return purchases;
  }

  private async fetchTokenTransfersForContract(
    chain: ChainConfig,
    tokenAddress: string,
    fromBlock: number,
    toBlock: number,
    watchedAddresses: string[]
  ): Promise<WhaleTokenPurchase[]> {
    const provider = await this.getProvider(chain.chainId);
    if (!provider) return [];

    let tokenInfo = this.tokenRegistry.getToken(tokenAddress, chain.chainId);
    if (!tokenInfo) return [];

    const purchases: WhaleTokenPurchase[] = [];
    const decimals = tokenInfo.decimals;
    const BLOCK_STEP = 2000;

    // Collect all logs first, then batch block lookups (P2-3 fix)
    const allLogs: { log: RawLog; blockNum: number }[] = [];

    for (let start = fromBlock; start <= toBlock; start += BLOCK_STEP) {
      const end = Math.min(start + BLOCK_STEP - 1, toBlock);

      try {
        const logs = await provider.send('eth_getLogs', [{
          address: tokenAddress,
          topics: [TRANSFER_TOPIC],
          fromBlock: '0x' + start.toString(16),
          toBlock: '0x' + end.toString(16),
        }]) as RawLog[];


        for (const log of logs) {
          const blockNum = parseInt(log.blockNumber, 16);
          allLogs.push({ log, blockNum });
        }
      } catch (err: any) {
        console.warn(`[TokenFetcher] Failed to fetch chunk ${start}-${end} for ${tokenInfo.symbol} on ${chain.name}: ${err.message}`);
      }
    }

    // Batch fetch unique blocks (P2-3 fix: avoid N+1 queries)
    const uniqueBlockNums = [...new Set(allLogs.map(l => l.blockNum))];
    const blockCache = new Map<number, any>();
    
    // Fetch blocks in parallel batches of 5
    for (let i = 0; i < uniqueBlockNums.length; i += 5) {
      const batch = uniqueBlockNums.slice(i, i + 5);
      const blocks = await Promise.all(
        batch.map(num => provider.getBlock(num).catch(() => null))
      );
      blocks.forEach((block, idx) => {
        if (block) blockCache.set(batch[idx], block);
      });
    }

    // Process logs with cached blocks
    for (const { log, blockNum } of allLogs) {
      const fromAddr = '0x' + log.topics[1].slice(26).toLowerCase();
      const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();
      const rawAmount = BigInt(log.data);
      const amount = Number(rawAmount) / Math.pow(10, decimals);

      if (amount <= 0) continue;

      const isWatched = watchedAddresses.length === 0 ||
        watchedAddresses.includes(fromAddr) ||
        watchedAddresses.includes(toAddr);

      if (!isWatched) continue;

      // Auto-discover unknown tokens
      if (!tokenInfo.coingeckoId) {
        const discovered = await this.tokenRegistry.fetchTokenInfo(tokenAddress, chain.chainId);
        if (discovered) {
          tokenInfo = discovered;
        }
      }

      // P2-6 fix: Use shared PriceFetcher instead of duplicate CoinGecko client
      const tokenPriceUsd = await this.priceFetcher.getTokenPriceByCoinId(tokenInfo.coingeckoId || '');
      // P3-12: Track price misses
      if (tokenPriceUsd === 0 && tokenInfo.coingeckoId) {
        metrics.priceMisses.inc({ chain_id: chain.chainId.toString(), token: tokenInfo.symbol });
      }
      const amountUsd = amount * tokenPriceUsd;

      if (amountUsd < 10000) continue;

      const block = blockCache.get(blockNum);

      const fromLabel = this.getAddressLabel(fromAddr);
      const toLabel = this.getAddressLabel(toAddr);

      const whaleAddr = watchedAddresses.includes(fromAddr) ? fromAddr :
                       watchedAddresses.includes(toAddr) ? toAddr : fromAddr;
      const isWhaleSender = watchedAddresses.includes(fromAddr);

      purchases.push({
        hash: log.transactionHash,
        chainId: chain.chainId,
        chainName: chain.name,
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol: tokenInfo.symbol,
        tokenName: tokenInfo.name,
        tokenDecimals: decimals,
        amount: amount.toString(),
        amountUsd,
        whaleAddress: whaleAddr,
        whaleLabel: isWhaleSender ? fromLabel : toLabel,
        whaleType: 'whale',
        counterparty: isWhaleSender ? toAddr : fromAddr,
        counterpartyLabel: isWhaleSender ? toLabel : fromLabel,
        counterpartyType: this.guessCounterpartyType(isWhaleSender ? toAddr : fromAddr, chain.chainId),
        timestamp: (block?.timestamp || Math.floor(Date.now() / 1000)) * 1000,
        blockNumber: blockNum,
        direction: isWhaleSender ? 'sell' : 'buy',
      });
    }

    return purchases;
  }

  private getAddressLabel(address: string): string {
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    return short;
  }

  private guessCounterpartyType(address: string, chainId?: number): string {
    // Use LabelDatabase if available (comprehensive CEX/deFi labels)
    if (this.labelDb && chainId) {
      const labelType = this.labelDb.labelType(address, chainId);
      if (labelType && labelType !== 'unknown') {
        return labelType;
      }
    }

    // Fallback to hardcoded list for backward compatibility
    const knownCex = [
      '0x28c6c06298d514db089934071355e5743bf21d60',
      '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
      '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8',
      '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
      '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be',
      '0xd551234ae421e3bcba99a0da6d736074f22192ff',
      '0x503828976d22510aad0201ac7ec88293211d23da',
      '0x742d35cc6634c0532925a3b844bc454e4438f44e',
    ];

    if (knownCex.includes(address.toLowerCase())) return 'cex';
    return 'unknown';
  }

  async getLatestBlockNumber(chainId: number): Promise<number> {
    const provider = await this.getProvider(chainId);
    if (!provider) return 0;
    return provider.getBlockNumber();
  }

  async fetchRecentPurchases(chain: ChainConfig, blocksBack: number = 100): Promise<WhaleTokenPurchase[]> {
    const provider = await this.getProvider(chain.chainId);
    if (!provider) return [];

    const latestBlock = await provider.getBlockNumber();
    const fromBlock = latestBlock - blocksBack;
    const cacheKey = chain.chainId;
    const cachedFrom = this.fetchBlockCache.get(cacheKey) || 0;

    const actualFrom = Math.max(fromBlock, cachedFrom + 1);
    if (actualFrom > latestBlock) return [];

    this.fetchBlockCache.set(chain.chainId, latestBlock);

    return this.fetchTokenTransfers(chain, actualFrom, latestBlock);
  }
}
