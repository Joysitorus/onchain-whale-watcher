import fs from 'fs';
import path from 'path';

export interface AddressLabel {
  name: string;
  type: 'cex' | 'dex' | 'market_maker' | 'whale' | 'bridge' | 'lending' | 'liquid_staking' | 'wrapped' | 'burn' | 'cold_wallet' | 'hot_wallet' | 'unknown';
}

interface RawLabelData {
  [chainId: string]: {
    [category: string]: {
      [address: string]: { name: string; type: string };
    };
  };
}

type ChainLabels = Map<string, AddressLabel>;

export class LabelDatabase {
  chains: Map<number, ChainLabels> = new Map();
  private arkhamCache: Map<string, AddressLabel> = new Map();
  private dynamicLabels: Map<string, AddressLabel> = new Map();
  private whaleCounter: number = 0;

  constructor() {
    this.loadKnownAddresses();
  }

  // P3-5: Allow setting counter from database on startup
  setWhaleCounter(value: number): void {
    this.whaleCounter = value;
  }

  // P3-5: Get current counter value for persistence
  getWhaleCounter(): number {
    return this.whaleCounter;
  }

  addDynamicLabel(address: string, chainId: number, name: string, type: AddressLabel['type'] = 'whale'): void {
    const key = `${address.toLowerCase()}:${chainId}`;
    this.dynamicLabels.set(key, { name, type });
    if (!this.chains.has(chainId)) {
      this.chains.set(chainId, new Map());
    }
    this.chains.get(chainId)!.set(address.toLowerCase(), { name, type });
  }

  isKnown(address: string, chainId: number): boolean {
    return this.lookup(address, chainId) !== undefined;
  }

  generateWhaleLabel(address: string, chainId: number, valueUsd: number): string {
    this.whaleCounter++;
    const shortAddr = `${address.slice(0, 4)}...${address.slice(-4)}`;
    const valueStr = valueUsd >= 10_000_000
      ? `$${(valueUsd / 1_000_000).toFixed(0)}M`
      : `$${(valueUsd / 1_000).toFixed(0)}K`;
    const labelName = `Whale ${valueStr} (${shortAddr})`;
    this.addDynamicLabel(address, chainId, labelName, 'whale');
    return labelName;
  }

  getDynamicLabels(): Array<{ address: string; chainId: number; name: string; type: string }> {
    const result: Array<{ address: string; chainId: number; name: string; type: string }> = [];
    for (const [key, label] of this.dynamicLabels) {
      const [addr, chainIdStr] = key.split(':');
      result.push({ address: addr, chainId: parseInt(chainIdStr), name: label.name, type: label.type });
    }
    return result;
  }

  private loadKnownAddresses(): void {
    const dataPath = path.resolve(__dirname, '../data/known-addresses.json');
    try {
      const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as RawLabelData;
      for (const [chainId, categories] of Object.entries(raw)) {
        const chainLabels: ChainLabels = new Map();
        for (const entries of Object.values(categories)) {
          for (const [address, info] of Object.entries(entries)) {
            chainLabels.set(address.toLowerCase(), {
              name: info.name,
              type: info.type as AddressLabel['type'],
            });
          }
        }
        this.chains.set(Number(chainId), chainLabels);
      }
      console.log(`[LabelDB] Loaded ${this.totalLabels()} known addresses`);
    } catch (err) {
      console.warn('[LabelDB] Could not load known-addresses.json:', err);
    }
  }

  private totalLabels(): number {
    let count = 0;
    for (const labels of this.chains.values()) {
      count += labels.size;
    }
    return count;
  }

  lookup(address: string, chainId: number): AddressLabel | undefined {
    const normalized = address.toLowerCase();
    const chainLabels = this.chains.get(chainId);
    if (chainLabels?.has(normalized)) {
      return chainLabels.get(normalized);
    }
    return this.arkhamCache.get(normalized);
  }

  label(address: string, chainId: number): string {
    const found = this.lookup(address, chainId);
    if (found) return found.name;
    return this.shortenAddress(address);
  }

  labelType(address: string, chainId: number): AddressLabel['type'] {
    return this.lookup(address, chainId)?.type ?? 'unknown';
  }

  addArkhamLabel(address: string, label: AddressLabel): void {
    this.arkhamCache.set(address.toLowerCase(), label);
  }

  private shortenAddress(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }
}
