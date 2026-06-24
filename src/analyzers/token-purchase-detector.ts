import { WhaleTokenPurchase, MonitoredTransfer } from '../types';
import { LabelDatabase } from '../label-db';
import { Database } from '../database/db';
import { config } from '../config';

interface TokenPurchaseSummary {
  tokenSymbol: string;
  tokenAddress: string;
  tokenName: string;
  chainId: number;
  chainName: string;
  totalAmountUsd: number;
  totalAmount: number;
  uniqueWhales: Set<string>;
  purchases: WhaleTokenPurchase[];
}

interface WhaleTokenActivity {
  whaleAddress: string;
  whaleLabel: string;
  chainId: number;
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenName: string;
  totalBoughtUsd: number;
  totalSoldUsd: number;
  netPositionUsd: number;
  direction: 'accumulating' | 'distributing' | 'mixed';
  txCount: number;
}

export class TokenPurchaseDetector {
  private recentPurchases: WhaleTokenPurchase[] = [];
  // P3-6: Configurable history size via env var
  private readonly maxHistory = parseInt(process.env.TOKEN_PURCHASE_HISTORY_SIZE || '500', 10);

  constructor(
    private labelDb: LabelDatabase,
    private db: Database
  ) {}

  addPurchases(purchases: WhaleTokenPurchase[]): void {
    this.recentPurchases.push(...purchases);
    if (this.recentPurchases.length > this.maxHistory) {
      this.recentPurchases = this.recentPurchases.slice(-this.maxHistory);
    }
  }

  detectWhaleTokenPurchases(transfers: MonitoredTransfer[]): WhaleTokenPurchase[] {
    const purchases: WhaleTokenPurchase[] = [];

    for (const tx of transfers) {
      const fromIsWhale = tx.fromType === 'whale' || tx.fromType === 'market_maker' ||
                         tx.fromLabel.startsWith('Whale ');
      const toIsWhale = tx.toType === 'whale' || tx.toType === 'market_maker' ||
                       tx.toLabel.startsWith('Whale ');

      if (fromIsWhale && !toIsWhale && tx.valueUsd >= config.minTxValueUsd) {
        purchases.push({
          hash: tx.hash,
          chainId: tx.chainId,
          chainName: tx.chainName,
          tokenAddress: 'native',
          tokenSymbol: config.chains.find(c => c.chainId === tx.chainId)?.nativeToken || 'NATIVE',
          tokenName: config.chains.find(c => c.chainId === tx.chainId)?.nativeToken || 'Native',
          tokenDecimals: 18,
          amount: tx.valueUsd.toString(),
          amountUsd: tx.valueUsd,
          whaleAddress: tx.from,
          whaleLabel: tx.fromLabel,
          whaleType: tx.fromType,
          counterparty: tx.to,
          counterpartyLabel: tx.toLabel,
          counterpartyType: tx.toType,
          timestamp: tx.timestamp,
          blockNumber: tx.blockNumber || 0,
          direction: 'sell',
        });
      }

      if (toIsWhale && !fromIsWhale && tx.valueUsd >= config.minTxValueUsd) {
        purchases.push({
          hash: tx.hash,
          chainId: tx.chainId,
          chainName: tx.chainName,
          tokenAddress: 'native',
          tokenSymbol: config.chains.find(c => c.chainId === tx.chainId)?.nativeToken || 'NATIVE',
          tokenName: config.chains.find(c => c.chainId === tx.chainId)?.nativeToken || 'Native',
          tokenDecimals: 18,
          amount: tx.valueUsd.toString(),
          amountUsd: tx.valueUsd,
          whaleAddress: tx.to,
          whaleLabel: tx.toLabel,
          whaleType: tx.toType,
          counterparty: tx.from,
          counterpartyLabel: tx.fromLabel,
          counterpartyType: tx.fromType,
          timestamp: tx.timestamp,
          blockNumber: tx.blockNumber || 0,
          direction: 'buy',
        });
      }
    }

    return purchases;
  }

  analyzeTokenPurchases(): TokenPurchaseSummary[] {
    const summaryMap = new Map<string, TokenPurchaseSummary>();

    for (const purchase of this.recentPurchases) {
      const key = `${purchase.tokenAddress}:${purchase.chainId}`;
      const existing = summaryMap.get(key);

      if (existing) {
        existing.totalAmountUsd += purchase.amountUsd;
        existing.totalAmount += parseFloat(purchase.amount);
        existing.uniqueWhales.add(purchase.whaleAddress.toLowerCase());
        existing.purchases.push(purchase);
      } else {
        summaryMap.set(key, {
          tokenSymbol: purchase.tokenSymbol,
          tokenAddress: purchase.tokenAddress,
          tokenName: purchase.tokenName,
          chainId: purchase.chainId,
          chainName: purchase.chainName,
          totalAmountUsd: purchase.amountUsd,
          totalAmount: parseFloat(purchase.amount),
          uniqueWhales: new Set([purchase.whaleAddress.toLowerCase()]),
          purchases: [purchase],
        });
      }
    }

    return Array.from(summaryMap.values())
      .sort((a, b) => b.totalAmountUsd - a.totalAmountUsd);
  }

  analyzeWhaleActivity(): WhaleTokenActivity[] {
    const whaleMap = new Map<string, WhaleTokenActivity>();

    for (const purchase of this.recentPurchases) {
      const key = `${purchase.whaleAddress}:${purchase.tokenAddress}:${purchase.chainId}`;
      const existing = whaleMap.get(key);

      if (existing) {
        if (purchase.direction === 'buy') {
          existing.totalBoughtUsd += purchase.amountUsd;
        } else {
          existing.totalSoldUsd += purchase.amountUsd;
        }
        existing.netPositionUsd = existing.totalBoughtUsd - existing.totalSoldUsd;
        existing.txCount++;
        existing.direction = existing.totalBoughtUsd > existing.totalSoldUsd * 1.5 ? 'accumulating' :
                            existing.totalSoldUsd > existing.totalBoughtUsd * 1.5 ? 'distributing' : 'mixed';
      } else {
        whaleMap.set(key, {
          whaleAddress: purchase.whaleAddress,
          whaleLabel: purchase.whaleLabel,
          chainId: purchase.chainId,
          chainName: purchase.chainName,
          tokenSymbol: purchase.tokenSymbol,
          tokenAddress: purchase.tokenAddress,
          tokenName: purchase.tokenName,
          totalBoughtUsd: purchase.direction === 'buy' ? purchase.amountUsd : 0,
          totalSoldUsd: purchase.direction === 'sell' ? purchase.amountUsd : 0,
          netPositionUsd: purchase.direction === 'buy' ? purchase.amountUsd : -purchase.amountUsd,
          direction: purchase.direction === 'buy' ? 'accumulating' : 'distributing',
          txCount: 1,
        });
      }
    }

    return Array.from(whaleMap.values())
      .sort((a, b) => Math.abs(b.netPositionUsd) - Math.abs(a.netPositionUsd));
  }

  getTopAccumulatedTokens(limit: number = 10): TokenPurchaseSummary[] {
    const summaries = this.analyzeTokenPurchases();
    return summaries.filter(s => {
      const buys = s.purchases.filter(p => p.direction === 'buy').reduce((sum, p) => sum + p.amountUsd, 0);
      const sells = s.purchases.filter(p => p.direction === 'sell').reduce((sum, p) => sum + p.amountUsd, 0);
      return buys > sells;
    }).slice(0, limit);
  }

  getTopDistributedTokens(limit: number = 10): TokenPurchaseSummary[] {
    const summaries = this.analyzeTokenPurchases();
    return summaries.filter(s => {
      const sells = s.purchases.filter(p => p.direction === 'sell').reduce((sum, p) => sum + p.amountUsd, 0);
      const buys = s.purchases.filter(p => p.direction === 'buy').reduce((sum, p) => sum + p.amountUsd, 0);
      return sells > buys;
    }).slice(0, limit);
  }

  getRecentPurchases(limit: number = 20): WhaleTokenPurchase[] {
    return this.recentPurchases
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getTokenPurchaseHistory(tokenAddress: string, chainId: number): WhaleTokenPurchase[] {
    return this.recentPurchases.filter(p =>
      p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() &&
      p.chainId === chainId
    );
  }

  getWhaleTokenActivity(whaleAddress: string, chainId: number): WhaleTokenActivity[] {
    return this.analyzeWhaleActivity().filter(a =>
      a.whaleAddress.toLowerCase() === whaleAddress.toLowerCase() &&
      a.chainId === chainId
    );
  }

  clear(): void {
    this.recentPurchases = [];
  }
}
