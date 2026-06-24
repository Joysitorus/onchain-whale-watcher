import { MonitoredTransfer, MarketSignal } from '../types';

interface SeenTransfer {
  hash: string;
  timestamp: number;
}

interface LastSignalState {
  direction: string;
  confidence: number;
  timestamp: number;
}

export class NotificationManager {
  private seenHashes: Map<string, SeenTransfer> = new Map();
  private lastSignal: LastSignalState | null = null;
  private notifiedWhales: Set<string> = new Set();

  private readonly dedupTtlMs = 30 * 60 * 1000;
  private readonly signalCooldownMs = 10 * 60 * 1000;
  private readonly minConfidenceChange = 20;
  // P3-11: Periodic cleanup interval
  private lastCleanupTime = 0;
  private readonly cleanupIntervalMs = 5 * 60 * 1000; // Every 5 minutes

  isTransferDuplicate(tx: MonitoredTransfer): boolean {
    if (!tx.hash) return false;
    const seen = this.seenHashes.get(tx.hash);
    if (!seen) return false;
    return (Date.now() - seen.timestamp) < this.dedupTtlMs;
  }

  markTransferSent(tx: MonitoredTransfer): void {
    if (!tx.hash) return;
    this.seenHashes.set(tx.hash, { hash: tx.hash, timestamp: Date.now() });
    // P3-11: Trigger periodic cleanup
    this.cleanupExpiredEntries();
  }

  // P3-11: Periodic cleanup of expired entries
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    if (now - this.lastCleanupTime < this.cleanupIntervalMs) return;
    this.lastCleanupTime = now;

    const cutoff = now - this.dedupTtlMs;
    let cleaned = 0;
    for (const [hash, data] of this.seenHashes) {
      if (data.timestamp < cutoff) {
        this.seenHashes.delete(hash);
        cleaned++;
      }
    }
    // Also cleanup notifiedWhales (keep for 1 hour)
    const whaleCutoff = now - 60 * 60 * 1000;
    // notifiedWhales is a Set<string> without timestamps, so we can't clean it easily
    // For now, just log the cleanup
    if (cleaned > 0) {
      console.log(`[NotifyManager] Cleaned ${cleaned} expired dedup entries`);
    }
  }

  isWhaleNotified(address: string): boolean {
    return this.notifiedWhales.has(address.toLowerCase());
  }

  markWhaleNotified(address: string): void {
    this.notifiedWhales.add(address.toLowerCase());
  }

  shouldNotifySignal(newSignal: MarketSignal): boolean {
    if (!this.lastSignal) return true;

    const timeSinceLastSignal = Date.now() - this.lastSignal.timestamp;
    if (timeSinceLastSignal < this.signalCooldownMs) return false;

    const directionChanged = newSignal.direction !== this.lastSignal.direction;
    const confidenceShift = Math.abs(newSignal.confidence - this.lastSignal.confidence);

    return directionChanged || confidenceShift >= this.minConfidenceChange;
  }

  updateLastSignal(signal: MarketSignal): void {
    this.lastSignal = {
      direction: signal.direction,
      confidence: signal.confidence,
      timestamp: signal.timestamp,
    };
  }

  filterNewTransfers(transfers: MonitoredTransfer[]): MonitoredTransfer[] {
    return transfers.filter(tx => !this.isTransferDuplicate(tx));
  }

  filterNewWhales(transfers: MonitoredTransfer[]): MonitoredTransfer[] {
    return transfers.filter(tx => {
      const whaleAddr = tx.fromLabel.startsWith('Whale ') ? tx.from :
                        tx.toLabel.startsWith('Whale ') ? tx.to : null;
      return whaleAddr ? !this.isWhaleNotified(whaleAddr) : true;
    });
  }

  getStats(): { deduped: number; whalesTracked: number; totalSeen: number } {
    return {
      deduped: this.seenHashes.size,
      whalesTracked: this.notifiedWhales.size,
      totalSeen: this.seenHashes.size,
    };
  }
}
