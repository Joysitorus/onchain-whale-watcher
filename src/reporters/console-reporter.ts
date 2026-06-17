import { MarketSignal, MonitoredTransfer } from '../types';
import { AnalysisResult } from '../analyzers/transaction-analyzer';

export class ConsoleReporter {
  reportSignal(signal: MarketSignal): void {
    const arrow = signal.direction === 'bullish' ? '▲' : signal.direction === 'bearish' ? '▼' : '◆';
    const color = signal.direction === 'bullish' ? '\x1b[32m' : signal.direction === 'bearish' ? '\x1b[31m' : '\x1b[33m';

    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log(`${color}  MARKET SIGNAL: ${signal.direction.toUpperCase()} ${arrow}\x1b[0m`);
    console.log(`  Confidence: ${signal.confidence}%`);
    console.log(`  ${signal.reason}`);
    console.log('══════════════════════════════════════════════');

    if (signal.relatedTransfers.length > 0) {
      console.log('\n  Related Transfers:');
      for (const tx of signal.relatedTransfers.slice(0, 5)) {
        console.log(`  [${tx.chainName}] $${(tx.valueUsd / 1_000_000).toFixed(2)}M`);
        console.log(`    ${tx.fromLabel} → ${tx.toLabel}`);
        console.log(`    ${tx.hash}`);
      }
    }
    console.log('');
  }

  reportAnalysis(analysis: AnalysisResult): void {
    console.log('\n--- Transaction Analysis Report ---');
    console.log(`  Exchange Inflow:  $${(analysis.exchangeInflow / 1_000_000).toFixed(2)}M`);
    console.log(`  Exchange Outflow: $${(analysis.exchangeOutflow / 1_000_000).toFixed(2)}M`);
    console.log(`  Net Exchange Flow: $${(analysis.netExchangeFlow / 1_000_000).toFixed(2)}M`);

    const flowSymbol = analysis.netExchangeFlow > 0 ? '→ (to exchanges)' : '← (from exchanges)';
    console.log(`  Flow Direction: ${flowSymbol}`);

    console.log(`  Whale Accumulation:  $${(analysis.whaleAccumulation / 1_000_000).toFixed(2)}M`);
    console.log(`  Whale Distribution: $${(analysis.whaleDistribution / 1_000_000).toFixed(2)}M`);

    if (analysis.patterns.length > 0) {
      console.log('\n  Patterns Detected:');
      for (const p of analysis.patterns) {
        console.log(`  ⚠ ${p}`);
      }
    }
    console.log('');
  }

  reportTransfers(transfers: MonitoredTransfer[]): void {
    if (transfers.length === 0) return;

    console.log(`\n  Monitored Transfers (${transfers.length}):`);
    for (const tx of transfers.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 10)) {
      const significanceIcon = tx.significance === 'critical' ? '🔴' : tx.significance === 'high' ? '🟠' : '🟡';
      console.log(`  ${significanceIcon} [${tx.chainName}] $${(tx.valueUsd / 1_000_000).toFixed(2)}M`);
      console.log(`     ${tx.fromLabel} → ${tx.toLabel}`);
      if (tx.hash) console.log(`     tx: ${tx.hash.slice(0, 10)}...${tx.hash.slice(-8)}`);
    }
  }
}
