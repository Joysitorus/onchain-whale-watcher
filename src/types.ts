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
  token?: string;
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
  token: string;
  timestamp: number;
  significance: 'low' | 'medium' | 'high' | 'critical';
}

export interface WhaleTokenPurchase {
  hash: string;
  chainId: number;
  chainName: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
  amount: string;
  amountUsd: number;
  whaleAddress: string;
  whaleLabel: string;
  whaleType: string;
  counterparty: string;
  counterpartyLabel: string;
  counterpartyType: string;
  timestamp: number;
  blockNumber: number;
  direction: 'buy' | 'sell';
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
  supplyImpact?: SupplyImpact;
  tokenPurchases?: WhaleTokenPurchase[];
}

export interface SupplyImpact {
  tokenSymbol: string;
  chainId: number;
  walletAddress: string;
  walletLabel: string;
  holdingsUsd: number;
  totalSupplyUsd: number;
  supplyPercentage: number;
  previousPercentage: number;
  changePercent: number;
  trend: 'accumulating' | 'distributing' | 'stable';
  tokenPrice: number;
}

export type ChainId = number;
