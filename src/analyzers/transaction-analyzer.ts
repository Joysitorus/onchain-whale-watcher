import { MonitoredTransfer } from '../types';
import { LabelDatabase } from '../label-db';
import { config } from '../config';

export interface AnalysisResult {
  exchangeInflow: number;
  exchangeOutflow: number;
  whaleAccumulation: number;
  whaleDistribution: number;
  netExchangeFlow: number;
  significantTransfers: MonitoredTransfer[];
  patterns: string[];
  timestamp: number;
  transferDirections: TransferDirection[];
}

export interface TransferDirection {
  hash: string;
  chainName: string;
  from: string;
  fromLabel: string;
  fromType: string;
  to: string;
  toLabel: string;
  toType: string;
  valueUsd: number;
  direction: 'exchange_to_cold' | 'cold_to_exchange' | 'exchange_to_hot' | 'hot_to_exchange' | 'cold_to_cold' | 'hot_to_hot' | 'whale_to_exchange' | 'exchange_to_whale' | 'unknown';
  timestamp: number;
}

export class TransactionAnalyzer {
  private recentTransfers: MonitoredTransfer[] = [];
  private seenHashes: Set<string> = new Set();
  private readonly historySize = 100;

  constructor(private labelDb: LabelDatabase) { }

  addTransfers(transfers: MonitoredTransfer[]): void {
    // Deduplicate by hash+chainId before adding
    for (const tx of transfers) {
      const key = `${tx.hash}:${tx.chainId}`;
      if (!this.seenHashes.has(key)) {
        this.seenHashes.add(key);
        this.recentTransfers.push(tx);
      }
    }
    
    // Trim history to max size
    if (this.recentTransfers.length > this.historySize) {
      const removed = this.recentTransfers.slice(0, this.recentTransfers.length - this.historySize);
      // Remove hashes for trimmed entries
      for (const tx of removed) {
        const key = `${tx.hash}:${tx.chainId}`;
        this.seenHashes.delete(key);
      }
      this.recentTransfers = this.recentTransfers.slice(-this.historySize);
    }
  }

  analyze(): AnalysisResult {
    const patterns: string[] = [];
    let exchangeInflow = 0;
    let exchangeOutflow = 0;
    let whaleAccumulation = 0;
    let whaleDistribution = 0;
    const significant: MonitoredTransfer[] = [];
    const transferDirections: TransferDirection[] = [];

    for (const tx of this.recentTransfers) {
      const fromType = tx.fromType;
      const toType = tx.toType;

      // Detect transfer direction
      const direction = this.detectTransferDirection(fromType, toType);
      if (direction !== 'unknown') {
        transferDirections.push({
          hash: tx.hash,
          chainName: tx.chainName,
          from: tx.from,
          fromLabel: tx.fromLabel,
          fromType,
          to: tx.to,
          toLabel: tx.toLabel,
          toType,
          valueUsd: tx.valueUsd,
          direction,
          timestamp: tx.timestamp,
        });
      }

      // Exchange inflows: from non-exchange to exchange
      if (toType === 'cex' && fromType !== 'cex') {
        exchangeInflow += tx.valueUsd;
        significant.push(tx);
      }

      // Exchange outflows: from exchange to non-exchange
      if (fromType === 'cex' && toType !== 'cex') {
        exchangeOutflow += tx.valueUsd;
        significant.push(tx);
      }

      // Whale accumulation: to known whale/accumulator
      if (toType === 'market_maker' || toType === 'whale') {
        whaleAccumulation += tx.valueUsd;
      }

      // Whale distribution: from known whale
      if (fromType === 'market_maker' || fromType === 'whale') {
        whaleDistribution += tx.valueUsd;
      }
    }

    const netExchangeFlow = exchangeInflow - exchangeOutflow;

    if (netExchangeFlow > 10_000_000) {
      patterns.push('Large net inflow to exchanges - potential selling pressure');
    } else if (netExchangeFlow < -10_000_000) {
      patterns.push('Large net outflow from exchanges - potential accumulation');
    }

    if (whaleAccumulation > whaleDistribution * 1.5) {
      patterns.push('Whale accumulation detected - smart money buying');
    } else if (whaleDistribution > whaleAccumulation * 1.5) {
      patterns.push('Whale distribution detected - smart money selling');
    }

    if (exchangeInflow > 50_000_000) {
      patterns.push('Massive exchange inflow alert - possible market sell-off');
    }

    if (exchangeOutflow > 50_000_000) {
      patterns.push('Massive exchange outflow - large withdrawal to cold storage');
    }

    // Analyze transfer directions for patterns
    const coldToExchange = transferDirections.filter(d => d.direction === 'cold_to_exchange');
    const exchangeToCold = transferDirections.filter(d => d.direction === 'exchange_to_cold');

    if (coldToExchange.length > 0) {
      const totalColdToExchange = coldToExchange.reduce((sum, d) => sum + d.valueUsd, 0);
      if (totalColdToExchange > 5_000_000) {
        patterns.push(`Cold wallet to exchange: $${(totalColdToExchange / 1_000_000).toFixed(1)}M - potential selling`);
      }
    }

    if (exchangeToCold.length > 0) {
      const totalExchangeToCold = exchangeToCold.reduce((sum, d) => sum + d.valueUsd, 0);
      if (totalExchangeToCold > 5_000_000) {
        patterns.push(`Exchange to cold wallet: $${(totalExchangeToCold / 1_000_000).toFixed(1)}M - accumulation`);
      }
    }

    return {
      exchangeInflow,
      exchangeOutflow,
      whaleAccumulation,
      whaleDistribution,
      netExchangeFlow,
      significantTransfers: significant.sort((a, b) => b.valueUsd - a.valueUsd),
      patterns,
      timestamp: Date.now(),
      transferDirections: transferDirections.sort((a, b) => b.valueUsd - a.valueUsd),
    };
  }

  private detectTransferDirection(fromType: string, toType: string): TransferDirection['direction'] {
    // Exchange to Cold Wallet
    if ((fromType === 'cex' || fromType === 'hot_wallet') && toType === 'cold_wallet') {
      return 'exchange_to_cold';
    }

    // Cold Wallet to Exchange
    if (fromType === 'cold_wallet' && (toType === 'cex' || toType === 'hot_wallet')) {
      return 'cold_to_exchange';
    }

    // Exchange to Hot Wallet
    if (fromType === 'cex' && toType === 'hot_wallet') {
      return 'exchange_to_hot';
    }

    // Hot Wallet to Exchange
    if (fromType === 'hot_wallet' && toType === 'cex') {
      return 'hot_to_exchange';
    }

    // Cold to Cold
    if (fromType === 'cold_wallet' && toType === 'cold_wallet') {
      return 'cold_to_cold';
    }

    // Hot to Hot
    if (fromType === 'hot_wallet' && toType === 'hot_wallet') {
      return 'hot_to_hot';
    }

    // Whale to Exchange
    if ((fromType === 'whale' || fromType === 'market_maker') && (toType === 'cex' || toType === 'hot_wallet')) {
      return 'whale_to_exchange';
    }

    // Exchange to Whale
    if ((fromType === 'cex' || fromType === 'hot_wallet') && (toType === 'whale' || toType === 'market_maker')) {
      return 'exchange_to_whale';
    }

    return 'unknown';
  }

  private validateTransfer(tx: MonitoredTransfer): boolean {
    return tx.valueUsd >= config.minTxValueUsd;
  }
}
