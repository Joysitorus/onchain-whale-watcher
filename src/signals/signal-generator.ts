import { MarketSignal, MonitoredTransfer } from '../types';
import { AnalysisResult } from '../analyzers/transaction-analyzer';

export class SignalGenerator {
  generate(analysis: AnalysisResult, recentTransfers: MonitoredTransfer[]): MarketSignal {
    let direction: MarketSignal['direction'] = 'neutral';
    let confidence = 0;
    const reasons: string[] = [];
    const relatedTransfers: MonitoredTransfer[] = [];

    // Factor 1: Exchange flow direction
    if (analysis.netExchangeFlow < -5_000_000) {
      confidence += 30;
      reasons.push(`Large exchange outflow (-$${(analysis.netExchangeFlow / 1_000_000).toFixed(1)}M) suggesting accumulation`);
    } else if (analysis.netExchangeFlow > 5_000_000) {
      confidence -= 30;
      reasons.push(`Large exchange inflow (+$${(analysis.netExchangeFlow / 1_000_000).toFixed(1)}M) suggesting selling`);
    }

    // Factor 2: Whale behavior
    if (analysis.whaleAccumulation > analysis.whaleDistribution * 1.5) {
      confidence += 25;
      reasons.push('Whale accumulation detected (smart money buying)');
    } else if (analysis.whaleDistribution > analysis.whaleAccumulation * 1.5) {
      confidence -= 25;
      reasons.push('Whale distribution detected (smart money selling)');
    }

    // Factor 3: Combined patterns
    const bullishPatterns = ['accumulation', 'outflow from exchanges', 'cold storage'];
    const bearishPatterns = ['selling pressure', 'inflow to exchanges', 'sell-off'];

    for (const p of analysis.patterns) {
      if (bullishPatterns.some(bp => p.toLowerCase().includes(bp))) {
        confidence += 15;
        reasons.push(p);
      } else if (bearishPatterns.some(bp => p.toLowerCase().includes(bp))) {
        confidence -= 15;
        reasons.push(p);
      }
    }

    // Factor 4: Significant individual transfers
    for (const tx of analysis.significantTransfers) {
      if (tx.valueUsd >= 10_000_000) {
        relatedTransfers.push(tx);
      }
    }

    // Determine direction
    if (confidence >= 30) {
      direction = 'bullish';
    } else if (confidence <= -30) {
      direction = 'bearish';
    } else {
      direction = 'neutral';
    }

    return {
      direction,
      confidence: Math.min(Math.abs(confidence), 100),
      reason: reasons.join('; ') || 'No significant signals detected',
      relatedTransfers,
      timestamp: Date.now(),
    };
  }
}
