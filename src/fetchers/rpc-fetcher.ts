import { ethers } from 'ethers';
import { config } from '../config';
import { ChainConfig } from '../config';
import { LabelDatabase } from '../label-db';
import { Transaction, MonitoredTransfer } from '../types';

export class RpcFetcher {
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();

  constructor(private labelDb: LabelDatabase) {
    for (const chain of config.chains) {
      if (chain.rpcUrl) {
        this.providers.set(chain.chainId, new ethers.JsonRpcProvider(chain.rpcUrl));
      }
    }
  }

  private getProvider(chainId: number): ethers.JsonRpcProvider | undefined {
    return this.providers.get(chainId);
  }

  async getLatestBlocks(chain: ChainConfig, count: number = 5): Promise<Transaction[]> {
    const provider = this.getProvider(chain.chainId);
    if (!provider) return [];

    try {
      const latestBlock = await provider.getBlockNumber();
      const transactions: Transaction[] = [];

      for (let i = 0; i < count; i++) {
        const blockNum = latestBlock - i;
        const block = await provider.getBlock(blockNum, true);
        if (!block || !block.transactions) continue;

        for (const tx of block.transactions) {
          const txData = tx as unknown as ethers.TransactionResponse;
          const valueEth = parseFloat(ethers.formatEther(txData.value));

          // Filter for significant transactions only
          if (valueEth < 1) continue;

          let valueUsd = valueEth * (await this.getEthUsdPrice(chain.chainId));

          transactions.push({
            hash: txData.hash,
            chainId: chain.chainId,
            chainName: chain.name,
            blockNumber: block.number,
            timestamp: block.timestamp * 1000,
            from: txData.from.toLowerCase(),
            to: (txData.to || '').toLowerCase(),
            value: txData.value.toString(),
            valueUsd,
            gasPrice: txData.gasPrice?.toString() || '0',
            gasUsed: '0',
          });
        }
      }

      return transactions;
    } catch (err: any) {
      console.warn(`[RPC] Error fetching blocks for ${chain.name}: ${err.message}`);
      return [];
    }
  }

  private async getEthUsdPrice(chainId: number): Promise<number> {
    if (chainId === 56) return 600;
    if (chainId === 137) return 0.7;
    return 3500;
  }

  async getPendingTransactions(chain: ChainConfig): Promise<MonitoredTransfer[]> {
    const provider = this.getProvider(chain.chainId);
    if (!provider) return [];

    try {
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

        const valueUsd = valueEth * (await this.getEthUsdPrice(chain.chainId));

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
          timestamp: Date.now(),
          significance: 'high',
        });
      }

      return transfers;
    } catch (err: any) {
      return [];
    }
  }

  async getAddressHistory(chain: ChainConfig, address: string, limit: number = 10): Promise<Transaction[]> {
    const provider = this.getProvider(chain.chainId);
    if (!provider) return [];

    try {
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

          const valueEth = parseFloat(ethers.formatEther(txData.value));
          const valueUsd = valueEth * (await this.getEthUsdPrice(chain.chainId));

          transactions.push({
            hash: txData.hash,
            chainId: chain.chainId,
            chainName: chain.name,
            blockNumber: block.number,
            timestamp: block.timestamp * 1000,
            from: txData.from.toLowerCase(),
            to: (txData.to || '').toLowerCase(),
            value: txData.value.toString(),
            valueUsd,
            gasPrice: txData.gasPrice?.toString() || '0',
            gasUsed: '0',
          });
        }
      }

      return transactions;
    } catch (err: any) {
      console.warn(`[RPC] Error fetching history for ${address}: ${err.message}`);
      return [];
    }
  }

  async traceTransaction(chain: ChainConfig, txHash: string): Promise<any> {
    const provider = this.getProvider(chain.chainId);
    if (!provider) return null;

    try {
      const tx = await provider.getTransaction(txHash);
      const receipt = await provider.getTransactionReceipt(txHash);
      return { tx, receipt };
    } catch {
      return null;
    }
  }
}
