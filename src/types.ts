export interface Transaction {
  hash: string;
  chainId: number;
  chainName: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string;
  value: string;
  valueUsd: number;
  gasPrice: string;
  gasUsed: string;
  tokenTransfers?: TokenTransfer[];
  methodSignature?: string;
}

export interface TokenTransfer {
  token: string;
  tokenAddress: string;
  symbol: string;
  amount: string;
  valueUsd: number;
  from: string;
  to: string;
}

export interface MonitoredTransfer {
  hash: string;
  chainId: number;
  chainName: string;
  from: string;
  fromLabel: string;
  fromType: string;
  to: string;
  toLabel: string;
  toType: string;
  valueUsd: number;
  token?: string;
  timestamp: number;
  significance: 'low' | 'medium' | 'high' | 'critical';
}

export interface ArkhamEntity {
  address: string;
  name: string;
  entityType: string;
  chain: string;
  firstSeen: string;
  totalValue: number;
  tags: string[];
}

export interface MarketSignal {
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reason: string;
  relatedTransfers: MonitoredTransfer[];
  timestamp: number;
}

export type ChainId = number;
