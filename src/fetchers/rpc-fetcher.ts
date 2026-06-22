import { ethers } from 'ethers';
import { config } from '../config';
import { ChainConfig } from '../config';
import { LabelDatabase } from '../label-db';
import { Transaction, MonitoredTransfer } from '../types';
import { PriceFetcher } from './price-fetcher';
import { rpcProviderManager } from './rpc-provider-manager';

export class RpcFetcher {
  private legacyProviders: Map<number, ethers.JsonRpcProvider> = new Map();
  private priceFetcher = new PriceFetcher();
  private useProviderManager: boolean;

  constructor(private labelDb: LabelDatabase) {
    this.useProviderManager = config.rpcProviderRotation && config.infuraKeys.length > 1;
    
    if (this.useProviderManager) {
      console.log(`[RPC] Using multi-provider rotation with ${config.infuraKeys.length} Infura keys`);
    } else {
      // Fallback to legacy single provider mode
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

  async getLatestBlocks(chain: ChainConfig, count: number = 5): Promise<Transaction[]> {
    const startTime = Date.now();
    let provider: ethers.JsonRpcProvider | null = null;
    
    try {
      provider = await this.getProvider(chain.chainId);
      if (!provider) return [];

      const latestBlock = await provider.getBlockNumber();
      const transactions: Transaction[] = [];

      for (let i = 0; i < count; i++) {
        const blockNum = latestBlock - i;
        const block = await provider.getBlock(blockNum, true);
        if (!block || !block.transactions) continue;

        for (const tx of block.transactions) {
          const txData = tx as unknown as ethers.TransactionResponse;
          const txValue = txData.value ?? 0n;
          const valueEth = parseFloat(ethers.formatEther(txValue));

          // Filter for significant transactions only
          if (valueEth < 1) continue;

          let valueUsd = valueEth * (await this.priceFetcher.getUsdPrice(chain.chainId));

          transactions.push({
            hash: txData.hash,
            chainId: chain.chainId,
            chainName: chain.name,
            blockNumber: block.number,
            timestamp: block.timestamp * 1000,
            from: txData.from.toLowerCase(),
            to: (txData.to || '').toLowerCase(),
            value: txValue.toString(),
            valueUsd,
            gasPrice: txData.gasPrice?.toString() || '0',
            gasUsed: '0',
          });
        }
      }

      // Report success
      if (this.useProviderManager && provider) {
        const responseTime = Date.now() - startTime;
        rpcProviderManager.reportSuccess(chain.chainId, provider._getConnection().url, responseTime);
      }

      return transactions;
    } catch (err: any) {
      // Report failure
      if (this.useProviderManager && provider) {
        const isRateLimit = rpcProviderManager.isRateLimitError(err);
        rpcProviderManager.reportFailure(chain.chainId, provider._getConnection().url, isRateLimit);
      }
      
      console.warn(`[RPC] Error fetching blocks for ${chain.name}: ${err.message}`);
      return [];
    }
  }

  async getPendingTransactions(chain: ChainConfig): Promise<MonitoredTransfer[]> {
    const startTime = Date.now();
    let provider: ethers.JsonRpcProvider | null = null;
    
    try {
      provider = await this.getProvider(chain.chainId);
      if (!provider) return [];

      const pendingBlock = await provider.send('eth_getBlockByNumber', ['pending', true]);
      if (!pendingBlock?.transactions) return [];

      const transfers: MonitoredTransfer[] = [];
      const txs: any[] = pendingBlock.transactions;

      for (const tx of txs) {
        const from = (tx.from || '').toLowerCase();
        const to = (tx.to || '').toLowerCase();
        const valueWei = BigInt(tx.value || '0');
        if (valueWei === 0n) continue;

        const valueEth = parseFloat(ethers.formatEther(valueWei));
        if (valueEth < 10) continue;

        const valueUsd = valueEth * (await this.priceFetcher.getUsdPrice(chain.chainId));

        transfers.push({
          hash: tx.hash || '',
          chainId: chain.chainId,
          chainName: chain.name,
          from,
          fromLabel: this.labelDb.label(from, chain.chainId),
          fromType: this.labelDb.labelType(from, chain.chainId),
          to,
          toLabel: this.labelDb.label(to, chain.chainId),
          toType: this.labelDb.labelType(to, chain.chainId),
          valueUsd,
          token: chain.nativeToken,
          timestamp: Date.now(),
          significance: 'high',
        });
      }

      // Report success
      if (this.useProviderManager && provider) {
        const responseTime = Date.now() - startTime;
        rpcProviderManager.reportSuccess(chain.chainId, provider._getConnection().url, responseTime);
      }

      return transfers;
    } catch (err: any) {
      // Report failure
      if (this.useProviderManager && provider) {
        const isRateLimit = rpcProviderManager.isRateLimitError(err);
        rpcProviderManager.reportFailure(chain.chainId, provider._getConnection().url, isRateLimit);
      }
      
      return [];
    }
  }

  async getAddressHistory(chain: ChainConfig, address: string, limit: number = 10): Promise<Transaction[]> {
    const startTime = Date.now();
    let provider: ethers.JsonRpcProvider | null = null;
    
    try {
      provider = await this.getProvider(chain.chainId);
      if (!provider) return [];

      const latestBlock = await provider.getBlockNumber();
      const transactions: Transaction[] = [];
      const addrLower = address.toLowerCase();

      for (let i = 0; i < 20 && transactions.length < limit; i++) {
        const blockNum = latestBlock - i;
        const block = await provider.getBlock(blockNum, true);
        if (!block || !block.transactions) continue;

        for (const tx of block.transactions) {
          const txData = tx as unknown as ethers.TransactionResponse;

          if (txData.from?.toLowerCase() !== addrLower &&
              txData.to?.toLowerCase() !== addrLower) continue;

          const histTxValue = txData.value ?? 0n;
          const valueEth = parseFloat(ethers.formatEther(histTxValue));
          if (valueEth <= 0) continue;
          const valueUsd = valueEth * (await this.priceFetcher.getUsdPrice(chain.chainId));

          transactions.push({
            hash: txData.hash,
            chainId: chain.chainId,
            chainName: chain.name,
            blockNumber: block.number,
            timestamp: block.timestamp * 1000,
            from: txData.from.toLowerCase(),
            to: (txData.to || '').toLowerCase(),
            value: histTxValue.toString(),
            valueUsd,
            gasPrice: txData.gasPrice?.toString() || '0',
            gasUsed: '0',
          });
        }
      }

      // Report success
      if (this.useProviderManager && provider) {
        const responseTime = Date.now() - startTime;
        rpcProviderManager.reportSuccess(chain.chainId, provider._getConnection().url, responseTime);
      }

      return transactions;
    } catch (err: any) {
      // Report failure
      if (this.useProviderManager && provider) {
        const isRateLimit = rpcProviderManager.isRateLimitError(err);
        rpcProviderManager.reportFailure(chain.chainId, provider._getConnection().url, isRateLimit);
      }
      
      console.warn(`[RPC] Error fetching history for ${address}: ${err.message}`);
      return [];
    }
  }

  async traceTransaction(chain: ChainConfig, txHash: string): Promise<any> {
    const startTime = Date.now();
    let provider: ethers.JsonRpcProvider | null = null;
    
    try {
      provider = await this.getProvider(chain.chainId);
      if (!provider) return null;

      const tx = await provider.getTransaction(txHash);
      const receipt = await provider.getTransactionReceipt(txHash);
      
      // Report success
      if (this.useProviderManager && provider) {
        const responseTime = Date.now() - startTime;
        rpcProviderManager.reportSuccess(chain.chainId, provider._getConnection().url, responseTime);
      }
      
      return { tx, receipt };
    } catch (err: any) {
      // Report failure
      if (this.useProviderManager && provider) {
        const isRateLimit = rpcProviderManager.isRateLimitError(err);
        rpcProviderManager.reportFailure(chain.chainId, provider._getConnection().url, isRateLimit);
      }
      
      return null;
    }
  }

  getProviderStatus() {
    if (this.useProviderManager) {
      return rpcProviderManager.getStatus();
    }
    return [];
  }
}
