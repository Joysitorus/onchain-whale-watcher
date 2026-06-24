import { MarketSignal, MonitoredTransfer } from '../types';
import { AnalysisResult } from '../analyzers/transaction-analyzer';

export class SignalGenerator {
  generate(analysis: AnalysisResult, recentTransfers: MonitoredTransfer[]): MarketSignal {
    let direction: MarketSignal['direction'] = 'neutral';
    let confidence = 0;
    const reasons: string[] = [];
    const relatedTransfers: MonitoredTransfer[] = [];

    // P2-5: Time decay factor - older transfers contribute less to confidence
    // Half-life of 5 minutes: after 5 min, influence is halved; after 10 min, quarter
    const HALF_LIFE_MS = 5 * 60 * 1000;
    const now = Date.now();

    // Calculate weighted average age of transfers for time decay
    let totalWeight = 0;
    let weightedAge = 0;
    for (const tx of recentTransfers) {
      const ageMs = now - tx.timestamp;
      const weight = Math.pow(0.5, ageMs / HALF_LIFE_MS);
      totalWeight += weight;
      weightedAge += weight * ageMs;
    }
    const avgAgeMs = totalWeight > 0 ? weightedAge / totalWeight : 0;
    const timeDecayFactor = Math.pow(0.5, avgAgeMs / HALF_LIFE_MS);

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

    // P2-5: Apply time decay to final confidence
    confidence = Math.round(confidence * timeDecayFactor);

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
