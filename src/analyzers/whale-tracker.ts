import { LabelDatabase } from '../label-db';
import { Database } from '../database/db';
import { RpcFetcher } from '../fetchers/rpc-fetcher';
import { SupplyFetcher } from '../fetchers/supply-fetcher';
import { MonitoredTransfer, MarketSignal, SupplyImpact } from '../types';
import { config } from '../config';

interface TrackedWhale {
  address: string;
  chainId: number;
  label: string;
  firstSeenValue: number;
  totalVolume: number;
  txCount: number;
  lastActive: number;
  status: 'active' | 'cold' | 'exchanged';
}

export class WhaleTracker {
  private newlyIdentified: MonitoredTransfer[] = [];
  private followUpResults: MonitoredTransfer[] = [];
  private supplyFetcher: SupplyFetcher;

  constructor(
    private labelDb: LabelDatabase,
    private db: Database,
    private rpcFetcher: RpcFetcher
  ) {
    this.supplyFetcher = new SupplyFetcher();
  }

  /**
   * Scan all transfers for unknown addresses making large transactions.
   * Auto-generate labels and register them for follow-up tracking.
   */
  async identifyNewWhales(transfers: MonitoredTransfer[]): Promise<MonitoredTransfer[]> {
    const newWhales: MonitoredTransfer[] = [];

    for (const tx of transfers) {
      // Check both sender and receiver
      for (const side of [tx.from, tx.to]) {
        const known = this.labelDb.isKnown(side, tx.chainId);
        if (known) continue;

        // Skip zero/burn addresses
        if (side === '0x0000000000000000000000000000000000000000' ||
            side === '0x000000000000000000000000000000000000dead') continue;

        // Generate label and register
        const labelName = this.labelDb.generateWhaleLabel(side, tx.chainId, tx.valueUsd);

        const whaleTx: MonitoredTransfer = {
          ...tx,
          fromLabel: this.labelDb.label(tx.from, tx.chainId),
          toLabel: this.labelDb.label(tx.to, tx.chainId),
          fromType: this.labelDb.labelType(tx.from, tx.chainId),
          toType: this.labelDb.labelType(tx.to, tx.chainId),
          token: tx.token || this.getNativeToken(tx.chainId),
        };

        const isSender = side === tx.from;
        console.log(`[WhaleTracker] \u{1F50D} New unknown whale detected: ${labelName}` +
          ` (${isSender ? 'sent' : 'received'} $${(tx.valueUsd / 1_000_000).toFixed(2)}M)`);

        await this.db.upsertWhale(side, tx.chainId, {
          label: labelName,
          hash: tx.hash,
          valueUsd: tx.valueUsd,
          timestamp: tx.timestamp,
        });

        newWhales.push(whaleTx);
      }
    }

    this.newlyIdentified.push(...newWhales);
    return newWhales;
  }

  /**
   * Follow up on previously tracked whales by fetching their recent activity.
   */
  async followUpTrackedWhales(): Promise<MonitoredTransfer[]> {
    const followUp: MonitoredTransfer[] = [];
    const trackedWhales = await this.db.getTrackedWhales(10);

    // P3-7: Parallelize RPC calls for tracked whales
    const whaleHistories = await Promise.all(
      trackedWhales.map(async (whale) => {
        const chain = config.chains.find(c => c.chainId === whale.chain_id);
        if (!chain || !chain.rpcUrl) return { whale, history: [] };
        const history = await this.rpcFetcher.getAddressHistory(chain, whale.address, 5);
        return { whale, history };
      })
    );

    for (const { whale, history } of whaleHistories) {
      for (const tx of history) {
        if (tx.valueUsd < config.minTxValueUsd) continue;

        const transfer: MonitoredTransfer = {
          hash: tx.hash,
          chainId: tx.chainId,
          chainName: tx.chainName,
          from: tx.from,
          fromLabel: this.labelDb.label(tx.from, tx.chainId),
          fromType: this.labelDb.labelType(tx.from, tx.chainId),
          to: tx.to,
          toLabel: this.labelDb.label(tx.to, tx.chainId),
          toType: this.labelDb.labelType(tx.to, tx.chainId),
          valueUsd: tx.valueUsd,
          token: tx.token || this.getNativeToken(tx.chainId),
          timestamp: tx.timestamp,
          blockNumber: tx.blockNumber || 0,
          significance: tx.valueUsd >= 10_000_000 ? 'critical' : tx.valueUsd >= 1_000_000 ? 'high' : 'medium',
        };

        followUp.push(transfer);

        // Update whale stats
        await this.db.upsertWhale(whale.address, whale.chain_id, {
          hash: tx.hash,
          valueUsd: tx.valueUsd,
          timestamp: tx.timestamp,
        });
      }
    }

    if (followUp.length > 0) {
      console.log(`[WhaleTracker] \u{1F504} Follow-up: ${followUp.length} new txs from ${trackedWhales.length} tracked whales`);
    }

    this.followUpResults.push(...followUp);
    return followUp;
  }

  /**
   * Check if a tracked whale has moved funds to an exchange (potential sell signal).
   */
  async detectExchangeMovement(): Promise<MonitoredTransfer[]> {
    const exchangeMovements: MonitoredTransfer[] = [];

    for (const tx of this.followUpResults) {
      const toType = this.labelDb.labelType(tx.to, tx.chainId);
      if (toType === 'cex') {
        const fromIsWhale = this.labelDb.labelType(tx.from, tx.chainId) === 'whale' ||
          tx.fromLabel.startsWith('Whale ');
        if (fromIsWhale) {
          exchangeMovements.push(tx);
        }
      }
    }

    return exchangeMovements;
  }

  /**
   * Generate a signal specifically about new whale activity.
   */
  async generateWhaleSignal(transfers: MonitoredTransfer[]): Promise<MarketSignal | null> {
    const newWhales = transfers.filter(t => t.fromLabel.startsWith('Whale ') || t.toLabel.startsWith('Whale '));
    if (newWhales.length === 0) return null;

    const totalNewWhaleValue = newWhales.reduce((s, t) => s + t.valueUsd, 0);
    const exchangeBound = newWhales.filter(t => t.toType === 'cex');
    const coldBound = newWhales.filter(t => t.toType !== 'cex' && t.toType !== 'unknown');

    let direction: MarketSignal['direction'] = 'neutral';
    let confidence = 0;
    let reason = '';
    let supplyImpact: SupplyImpact | undefined;

    // Find the most significant whale for supply impact analysis
    const topWhale = newWhales.reduce((max, t) => t.valueUsd > max.valueUsd ? t : max, newWhales[0]);
    const whaleAddr = topWhale.fromLabel.startsWith('Whale ') ? topWhale.from : topWhale.to;

    // Calculate supply impact for native tokens
    const supplyData = await this.supplyFetcher.getNativeTokenSupply(topWhale.chainId);
    if (supplyData) {
      // Load state from database (persists across restarts)
      const dbState = await this.db.getWhaleState(whaleAddr, topWhale.chainId);
      const currentHoldings = (dbState?.holdingsUsd || 0) + topWhale.valueUsd;

      const tokenPrice = supplyData.circulating > 0 ? supplyData.totalUsd / supplyData.circulating : 0;
      const currentPercentage = this.supplyFetcher.calculateSupplyPercentage(
        currentHoldings, tokenPrice, supplyData.circulating
      );

      const prevPercentage = dbState?.previousPercentage || 0;
      const trend = this.supplyFetcher.getAccumulationSignal(currentPercentage, prevPercentage);

      // Persist state to database
      await this.db.updateWhaleState(whaleAddr, topWhale.chainId, currentHoldings, currentPercentage);

      supplyImpact = {
        tokenSymbol: config.chains.find(c => c.chainId === topWhale.chainId)?.nativeToken || 'TOKEN',
        chainId: topWhale.chainId,
        walletAddress: whaleAddr,
        walletLabel: topWhale.fromLabel.startsWith('Whale ') ? topWhale.fromLabel : topWhale.toLabel,
        holdingsUsd: currentHoldings,
        totalSupplyUsd: supplyData.totalUsd,
        supplyPercentage: currentPercentage,
        previousPercentage: prevPercentage,
        changePercent: trend.changePercent,
        trend: trend.signal,
        tokenPrice,
      };

      // Adjust signal based on supply accumulation
      if (trend.signal === 'accumulating' && currentPercentage > 0.01) {
        confidence += 20;
        reason += ` | Whale accumulating ${currentPercentage.toFixed(4)}% of supply`;
      } else if (trend.signal === 'distributing') {
        confidence -= 15;
        reason += ` | Whale distributing ${Math.abs(trend.changePercent).toFixed(4)}% of supply`;
      }
    }

    if (exchangeBound.length > 0 && totalNewWhaleValue > 5_000_000) {
      direction = 'bearish';
      confidence += 40;
      reason = `${exchangeBound.length} new whale(s) moved $${(totalNewWhaleValue / 1_000_000).toFixed(1)}M to exchanges - potential sell pressure from unknown entities` + reason;
    } else if (coldBound.length > 0 && totalNewWhaleValue > 5_000_000) {
      direction = 'bullish';
      confidence += 30;
      reason = `${coldBound.length} new whale(s) accumulated $${(totalNewWhaleValue / 1_000_000).toFixed(1)}M - new smart money entering` + reason;
    } else {
      reason = `${newWhales.length} new whale(s) detected moving $${(totalNewWhaleValue / 1_000_000).toFixed(1)}M - monitoring for patterns` + reason;
    }

    return {
      direction,
      confidence: Math.min(Math.abs(confidence), 100),
      reason,
      relatedTransfers: newWhales,
      timestamp: Date.now(),
      supplyImpact,
    };
  }

  getNewlyIdentified(): MonitoredTransfer[] {
    return this.newlyIdentified;
  }

  clear(): void {
    this.newlyIdentified = [];
    this.followUpResults = [];
  }

  private getNativeToken(chainId: number): string {
    // P2-9: Use config.chains instead of hardcoded map
    const chain = config.chains.find(c => c.chainId === chainId);
    return chain?.nativeToken || 'ETH';
  }
}
