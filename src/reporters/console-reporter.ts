import { MarketSignal, MonitoredTransfer } from '../types';
import { AnalysisResult } from '../analyzers/transaction-analyzer';

interface TokenPurchaseSummary {
  tokenSymbol: string;
  tokenAddress: string;
  tokenName: string;
  chainId: number;
  chainName: string;
  totalAmountUsd: number;
  totalAmount: number;
  uniqueWhales: Set<string>;
  purchases: any[];
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

export class ConsoleReporter {
  reportSignal(signal: MarketSignal): void {
    const arrow = signal.direction === 'bullish' ? '\u25B2' : signal.direction === 'bearish' ? '\u25BC' : '\u25C6';
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
        console.log(`    ${tx.fromLabel} \u2192 ${tx.toLabel}`);
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

    const flowSymbol = analysis.netExchangeFlow > 0 ? '\u2192 (to exchanges)' : '\u2190 (from exchanges)';
    console.log(`  Flow Direction: ${flowSymbol}`);

    console.log(`  Whale Accumulation:  $${(analysis.whaleAccumulation / 1_000_000).toFixed(2)}M`);
    console.log(`  Whale Distribution: $${(analysis.whaleDistribution / 1_000_000).toFixed(2)}M`);

    if (analysis.patterns.length > 0) {
      console.log('\n  Patterns Detected:');
      for (const p of analysis.patterns) {
        console.log(`  \u26A0 ${p}`);
      }
    }
    console.log('');
  }

  reportTransfers(transfers: MonitoredTransfer[]): void {
    if (transfers.length === 0) return;

    console.log(`\n  Monitored Transfers (${transfers.length}):`);
    for (const tx of transfers.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 10)) {
      const significanceIcon = tx.significance === 'critical' ? '\uD83D\uDD34' : tx.significance === 'high' ? '\uD83D\uDFE0' : '\uD83D\uDFE1';
      console.log(`  ${significanceIcon} [${tx.chainName}] $${(tx.valueUsd / 1_000_000).toFixed(2)}M`);
      console.log(`     ${tx.fromLabel} \u2192 ${tx.toLabel}`);
      if (tx.hash) console.log(`     tx: ${tx.hash.slice(0, 10)}...${tx.hash.slice(-8)}`);
    }
  }

  reportTokenPurchases(
    summaries: TokenPurchaseSummary[],
    whaleActivities: WhaleTokenActivity[]
  ): void {
    if (summaries.length === 0 && whaleActivities.length === 0) return;

    console.log('\n══════════════════════════════════════════════');
    console.log('  WHALE TOKEN PURCHASE ACTIVITY');
    console.log('══════════════════════════════════════════════');

    if (summaries.length > 0) {
      console.log('\n  Top Tokens by Whale Volume:');
      for (const s of summaries.slice(0, 10)) {
        const buys = s.purchases.filter((p: any) => p.direction === 'buy').reduce((sum: number, p: any) => sum + p.amountUsd, 0);
        const sells = s.purchases.filter((p: any) => p.direction === 'sell').reduce((sum: number, p: any) => sum + p.amountUsd, 0);
        const net = buys - sells;
        const netStr = net > 0 ? `+$${(net / 1000).toFixed(1)}K` : `-$${(Math.abs(net) / 1000).toFixed(1)}K`;
        const color = net > 0 ? '\x1b[32m' : '\x1b[31m';
        console.log(`  ${color}${s.tokenSymbol}\x1b[0m (${s.chainName}) - $${(s.totalAmountUsd / 1000).toFixed(1)}K total | ${s.uniqueWhales.size} whales | Net: ${netStr}`);
      }
    }

    if (whaleActivities.length > 0) {
      console.log('\n  Whale Token Positions:');
      for (const a of whaleActivities.slice(0, 10)) {
        const icon = a.direction === 'accumulating' ? '\uD83D\uDCC8' : a.direction === 'distributing' ? '\uD83D\uDCC9' : '\u27A1\uFE0F';
        console.log(`  ${icon} ${a.whaleLabel} | ${a.tokenSymbol} (${a.chainName})`);
        console.log(`     Bought: $${(a.totalBoughtUsd / 1000).toFixed(1)}K | Sold: $${(a.totalSoldUsd / 1000).toFixed(1)}K | Net: $${(Math.abs(a.netPositionUsd) / 1000).toFixed(1)}K ${a.direction}`);
      }
    }

    console.log('');
  }
}
