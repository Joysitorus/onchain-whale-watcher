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
  private priceFetcher: PriceFetcher;
  private fetchBlockCache: Map<number, number> = new Map();
  private useProviderManager: boolean;

  constructor(private tokenRegistry: TokenRegistry, private labelDb?: LabelDatabase, sharedPriceFetcher?: PriceFetcher) {
    this.priceFetcher = sharedPriceFetcher || new PriceFetcher();
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

    // Get tokens for this chain using ROTATION (scan different subset each cycle)
    // This ensures ALL tokens get tracked over multiple cycles, not just the first N
    const TOKENS_PER_BATCH: Record<number, number> = {
      1: 15,    // Ethereum: 15 per batch (50 total ÷ 4 batches ≈ 4 cycles)
      56: 5,    // BSC: 5 per batch (25 total ÷ 5 batches = 5 cycles)
      137: 8,   // Polygon: 8 per batch
      42161: 8, // Arbitrum: 8 per batch
      43114: 5, // Avalanche: 5 per batch
      10: 8,    // Optimism: 8 per batch
    };
    const batchSize = TOKENS_PER_BATCH[chain.chainId] || 10;
    const tokensToFetch = this.tokenRegistry.getTokensForRotation(chain.chainId, batchSize);

    // BSC needs delays between token fetches to avoid -32005 rate limits on PublicNode
    const INTER_TOKEN_DELAY_MS: Record<number, number> = {
      56: 3000,   // BSC: 3s delay between tokens (increased from 2s)
      137: 1000,  // Polygon: 1s delay (increased from 500ms)
    };
    const interTokenDelay = INTER_TOKEN_DELAY_MS[chain.chainId] || 0;
    let consecutiveRateLimits = 0; // Track consecutive rate limits to stop early

    for (let i = 0; i < tokensToFetch.length; i++) {
      const tokenInfo = tokensToFetch[i];
      // Validate address before making RPC call (prevents invalid address errors)
      if (!this.isValidEthAddress(tokenInfo.address)) {
        console.warn(`[TokenFetcher] Skipping invalid address for ${tokenInfo.symbol} on ${chain.name}: ${tokenInfo.address}`);
        continue;
      }

      // If 2+ consecutive rate limits, skip remaining tokens (provider is saturated)
      if (consecutiveRateLimits >= 2) {
        console.warn(`[TokenFetcher] ${chain.name}: ${consecutiveRateLimits} consecutive rate limits - skipping remaining ${tokensToFetch.length - i} tokens`);
        break;
      }

      // Add delay between token fetches for rate-limited chains
      if (interTokenDelay > 0 && i > 0) {
        // Use longer delay after a rate limit hit
        const delay = consecutiveRateLimits > 0 ? interTokenDelay * 3 : interTokenDelay;
        await new Promise(resolve => setTimeout(resolve, delay));
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
        consecutiveRateLimits = 0; // Reset on success
      } catch (err: any) {
        const msg = err.message || '';
        // Archive error = provider is behind, all subsequent tokens will also fail
        if (msg.includes('Archive requests') || msg.includes('403 Forbidden')) {
          console.warn(`[TokenFetcher] Archive block error on ${chain.name} - provider is behind, skipping remaining tokens`);
          break; // Skip all remaining tokens for this chain
        }
        // Rate limit exceeded = skip this token, try next one with longer delay
        if (msg.includes('-32005') || msg.includes('limit exceeded')) {
          consecutiveRateLimits++;
          console.warn(`[TokenFetcher] Rate limit on ${tokenInfo.symbol} (${chain.name}) [${consecutiveRateLimits}/${tokensToFetch.length}] - skipping to next token`);
          continue; // Try next token instead of stopping entirely
        }
        console.warn(`[TokenFetcher] Failed to fetch transfers for ${tokenInfo.symbol} (${tokenInfo.address}) on ${chain.name}: ${msg.substring(0, 100)}`);
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
    // PublicNode limits eth_getLogs to 50 blocks max (error: "BLOCK_STEP 0x7d0 too large — maximum 0x32")
    // Different providers have different limits; use conservative 49 for all chains
    const BLOCK_STEP_PER_CHAIN: Record<number, number> = {
      1: 49,     // Ethereum - Infura allows more, but keep consistent
      56: 49,    // BSC - PublicNode strict 50 block limit
      137: 49,   // Polygon - PublicNode strict 50 block limit
      42161: 49, // Arbitrum
      43114: 49, // Avalanche
      10: 49,    // Optimism
    };
    const BLOCK_STEP = BLOCK_STEP_PER_CHAIN[chain.chainId] || 49;

    // Collect all logs first, then batch block lookups (P2-3 fix)
    const allLogs: { log: RawLog; blockNum: number }[] = [];

    for (let start = fromBlock; start <= toBlock; start += BLOCK_STEP) {
      const end = Math.min(start + BLOCK_STEP - 1, toBlock);

      // Retry logic for rate limits and transient errors
      let lastError: any = null;
      for (let retry = 0; retry < 3; retry++) {
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
          lastError = null;
          break; // Success, exit retry loop
        } catch (err: any) {
          lastError = err;
          const msg = err.message?.toLowerCase() || '';
          const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('limit exceeded') || msg.includes('-32005');
          const isTimeout = msg.includes('-32002') || msg.includes('timeout') || msg.includes('timed out');
          
          if ((isRateLimit || isTimeout) && retry < 2) {
            // Exponential backoff: 2s, 4s
            const delay = 2000 * Math.pow(2, retry);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          // Non-retryable error or last retry
          break;
        }
      }

      if (lastError) {
        const msg = lastError.message?.substring(0, 150) || '';
        console.warn(`[TokenFetcher] Failed to fetch chunk ${start}-${end} for ${tokenInfo.symbol} on ${chain.name}: ${msg}`);
        
        // Throw critical errors up to caller for chain-level skipping
        if (msg.includes('Archive requests') || msg.includes('403 Forbidden')) {
          throw lastError;
        }
        if (msg.includes('-32005') || msg.includes('limit exceeded')) {
          throw lastError;
        }
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
    // P4: Batch-fetch all unique CoinGecko prices BEFORE processing logs
    // This reduces N individual API calls to 1 batch call
    const uniqueCoinGeckoIds = new Set<string>();
    const logsWithAddresses: { log: RawLog; blockNum: number; fromAddr: string; toAddr: string }[] = [];
    
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

      logsWithAddresses.push({ log, blockNum, fromAddr, toAddr });
      
      if (tokenInfo.coingeckoId) {
        uniqueCoinGeckoIds.add(tokenInfo.coingeckoId);
      }
    }

    // Batch-fetch all prices in one CoinGecko API call (instead of N individual calls)
    let priceMap = new Map<string, number>();
    if (uniqueCoinGeckoIds.size > 0) {
      priceMap = await this.priceFetcher.getTokenPricesByCoinIds([...uniqueCoinGeckoIds]);
    }

    // Process logs with batch-fetched prices
    for (const { log, blockNum, fromAddr, toAddr } of logsWithAddresses) {
      const rawAmount = BigInt(log.data);
      const amount = Number(rawAmount) / Math.pow(10, decimals);

      // Auto-discover unknown tokens
      let currentTokenInfo = tokenInfo;
      if (!currentTokenInfo.coingeckoId) {
        const discovered = await this.tokenRegistry.fetchTokenInfo(tokenAddress, chain.chainId);
        if (discovered) {
          currentTokenInfo = discovered;
          // Fetch price for newly discovered token
          if (discovered.coingeckoId) {
            const newPrice = await this.priceFetcher.getTokenPriceByCoinId(discovered.coingeckoId);
            priceMap.set(discovered.coingeckoId, newPrice);
          }
        }
      }

      // Use batch-fetched price (or individual fetch for newly discovered tokens)
      const tokenPriceUsd = priceMap.get(currentTokenInfo.coingeckoId || '') ?? 
        await this.priceFetcher.getTokenPriceByCoinId(currentTokenInfo.coingeckoId || '');
      
      // P3-12: Track price misses
      if (tokenPriceUsd === 0 && currentTokenInfo.coingeckoId) {
        metrics.priceMisses.inc({ chain_id: chain.chainId.toString(), token: currentTokenInfo.symbol });
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
        tokenSymbol: currentTokenInfo.symbol,
        tokenName: currentTokenInfo.name,
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

  // Reduced blocksBack from 100 to 50 to stay within PublicNode's 50-block eth_getLogs limit
  async fetchRecentPurchases(chain: ChainConfig, blocksBack: number = 50): Promise<WhaleTokenPurchase[]> {
    const provider = await this.getProvider(chain.chainId);
    if (!provider) return [];

    // Get latest block from the SAME provider that will be used for eth_getLogs
    // This prevents archive errors when Infura returns latest but PublicNode is behind
    let latestBlock: number;
    try {
      latestBlock = await provider.getBlockNumber();
    } catch (err: any) {
      console.warn(`[TokenFetcher] Failed to get block number for ${chain.name}: ${err.message?.substring(0, 80)}`);
      return [];
    }

    const fromBlock = latestBlock - blocksBack;
    const cacheKey = chain.chainId;
    const cachedFrom = this.fetchBlockCache.get(cacheKey) || 0;

    const actualFrom = Math.max(fromBlock, cachedFrom + 1);
    if (actualFrom > latestBlock) return [];

    this.fetchBlockCache.set(chain.chainId, latestBlock);

    try {
      return await this.fetchTokenTransfers(chain, actualFrom, latestBlock);
    } catch (err: any) {
      // Archive or rate limit error = provider is behind, skip this chain this cycle
      const msg = err.message || '';
      if (msg.includes('Archive requests') || msg.includes('-32005') || msg.includes('limit exceeded')) {
        console.warn(`[TokenFetcher] Skipping ${chain.name} this cycle: ${msg.substring(0, 80)}`);
      }
      return [];
    }
  }
}
