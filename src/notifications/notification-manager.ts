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

  isTransferDuplicate(tx: MonitoredTransfer): boolean {
    if (!tx.hash) return false;
    const seen = this.seenHashes.get(tx.hash);
    if (!seen) return false;
    return (Date.now() - seen.timestamp) < this.dedupTtlMs;
  }

  markTransferSent(tx: MonitoredTransfer): void {
    if (!tx.hash) return;
    this.seenHashes.set(tx.hash, { hash: tx.hash, timestamp: Date.now() });
    if (this.seenHashes.size > 500) {
      const entries = Array.from(this.seenHashes.entries());
      const cutoff = Date.now() - this.dedupTtlMs;
      for (const [hash, data] of entries) {
        if (data.timestamp < cutoff) {
          this.seenHashes.delete(hash);
        }
      }
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
