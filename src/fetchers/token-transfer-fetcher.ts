import { ethers } from 'ethers';
import axios from 'axios';
import { config, ChainConfig } from '../config';
import { TokenRegistry, TRANSFER_TOPIC } from '../tokens/token-registry';
import { PriceFetcher } from './price-fetcher';
import { MonitoredTransfer, WhaleTokenPurchase } from '../types';
import { rpcProviderManager } from './rpc-provider-manager';

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

  constructor(private tokenRegistry: TokenRegistry) {
    this.useProviderManager = config.rpcProviderRotation && config.infuraKeys.length > 1;

    if (!this.useProviderManager) {
      // Fallback: create own providers (only when rotation is disabled)
      for (const chain of config.chains) {
        if (chain.rpcUrl) {
          this.legacyProviders.set(chain.chainId, new ethers.JsonRpcProvider(chain.rpcUrl));
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

    for (const tokenInfo of this.tokenRegistry.getTokensByChain(chain.chainId)) {
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

          const tokenPriceUsd = await this.getTokenPriceUsd(tokenInfo.coingeckoId);
          const amountUsd = amount * tokenPriceUsd;

          if (amountUsd < 10000) continue;

          const block = await provider.getBlock(parseInt(log.blockNumber, 16));

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
            counterpartyType: this.guessCounterpartyType(isWhaleSender ? toAddr : fromAddr),
            timestamp: (block?.timestamp || Math.floor(Date.now() / 1000)) * 1000,
            blockNumber: parseInt(log.blockNumber, 16),
            direction: isWhaleSender ? 'sell' : 'buy',
          });
        }
      } catch (err: any) {
        // Log failed chunks for debugging
        console.warn(`[TokenFetcher] Failed to fetch chunk ${start}-${end} for ${tokenInfo.symbol} on ${chain.name}: ${err.message}`);
      }
    }

    return purchases;
  }

  private async getTokenPriceUsd(coingeckoId?: string): Promise<number> {
    if (!coingeckoId) return 0;
    try {
      // Use the shared price fetcher's axios instance with rate limiting
      const { data } = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      return data[coingeckoId]?.usd || 0;
    } catch (err: any) {
      if (err?.response?.status === 429) {
        console.warn(`[TokenFetcher] CoinGecko rate limited for ${coingeckoId}`);
      }
      return 0;
    }
  }

  private getAddressLabel(address: string): string {
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    return short;
  }

  private guessCounterpartyType(address: string): string {
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
