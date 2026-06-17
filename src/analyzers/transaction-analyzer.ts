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
}

export class TransactionAnalyzer {
  private recentTransfers: MonitoredTransfer[] = [];
  private readonly historySize = 100;

  constructor(private labelDb: LabelDatabase) { }

  addTransfers(transfers: MonitoredTransfer[]): void {
    this.recentTransfers.push(...transfers);
    if (this.recentTransfers.length > this.historySize) {
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

    for (const tx of this.recentTransfers) {
      const fromType = tx.fromType;
      const toType = tx.toType;

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

    return {
      exchangeInflow,
      exchangeOutflow,
      whaleAccumulation,
      whaleDistribution,
      netExchangeFlow,
      significantTransfers: significant.sort((a, b) => b.valueUsd - a.valueUsd),
      patterns,
      timestamp: Date.now(),
    };
  }

  private validateTransfer(tx: MonitoredTransfer): boolean {
    return tx.valueUsd >= config.minTxValueUsd;
  }
}
