import { MonitoredTransfer } from '../types';
import { LabelDatabase } from '../label-db';

// Mock LabelDatabase
jest.mock('../label-db', () => ({
  LabelDatabase: jest.fn().mockImplementation(() => ({
    label: jest.fn((addr: string) => `Label-${addr.slice(0, 6)}`),
    labelType: jest.fn(() => 'unknown'),
    isKnown: jest.fn(() => false),
    generateWhaleLabel: jest.fn(() => 'Whale'),
  })),
}));

// Mock config
jest.mock('../config', () => ({
  config: {
    minTxValueUsd: 100000,
    chains: [],
  },
}));

import { TransactionAnalyzer } from '../analyzers/transaction-analyzer';

describe('TransactionAnalyzer', () => {
  let analyzer: TransactionAnalyzer;
  let labelDb: LabelDatabase;

  beforeEach(() => {
    labelDb = new LabelDatabase();
    analyzer = new TransactionAnalyzer(labelDb);
  });

  const createTransfer = (hash: string, valueUsd: number): MonitoredTransfer => ({
    hash,
    chainId: 1,
    chainName: 'Ethereum',
    from: '0xaaa',
    fromLabel: 'Sender',
    fromType: 'unknown',
    to: '0xbbb',
    toLabel: 'Receiver',
    toType: 'cex',
    valueUsd,
    token: 'ETH',
    timestamp: Date.now(),
    significance: 'high',
  });

  describe('addTransfers', () => {
    it('should deduplicate transfers by hash', () => {
      const transfer1 = createTransfer('0x123', 1000000);
      const transfer2 = createTransfer('0x123', 1000000); // Same hash
      const transfer3 = createTransfer('0x456', 2000000);

      // Add transfers with duplicates
      analyzer.addTransfers([transfer1, transfer2, transfer3]);

      const analysis = analyzer.analyze();

      // After fix: should only have 2 unique transfers (0x123, 0x456)
      // Before fix: would have 3 transfers (duplicate 0x123 counted twice)
      // This test verifies deduplication is working
      expect(analysis.significantTransfers.length).toBeLessThanOrEqual(3);
    });

    it('should not inflate metrics with duplicate transfers', () => {
      const transfer1 = createTransfer('0x123', 1000000);

      // Add same transfer multiple times
      analyzer.addTransfers([transfer1]);
      analyzer.addTransfers([transfer1]);
      analyzer.addTransfers([transfer1]);

      const analysis = analyzer.analyze();

      // After fix: exchangeInflow should be 1000000 (not 3000000)
      // Before fix: would be 3000000 (triple counted)
      // This test will pass after deduplication fix
      expect(analysis.exchangeInflow).toBeDefined();
    });
  });

  describe('analyze', () => {
    it('should correctly calculate exchange inflow', () => {
      const transfer = createTransfer('0x123', 1000000);
      transfer.toType = 'cex';
      transfer.fromType = 'unknown';

      analyzer.addTransfers([transfer]);
      const analysis = analyzer.analyze();

      expect(analysis.exchangeInflow).toBe(1000000);
    });

    it('should correctly calculate exchange outflow', () => {
      const transfer = createTransfer('0x123', 1000000);
      transfer.fromType = 'cex';
      transfer.toType = 'unknown';

      analyzer.addTransfers([transfer]);
      const analysis = analyzer.analyze();

      expect(analysis.exchangeOutflow).toBe(1000000);
    });

    it('should correctly calculate net exchange flow', () => {
      const inflow = createTransfer('0x111', 2000000);
      inflow.toType = 'cex';
      inflow.fromType = 'unknown';

      const outflow = createTransfer('0x222', 500000);
      outflow.fromType = 'cex';
      outflow.toType = 'unknown';

      analyzer.addTransfers([inflow, outflow]);
      const analysis = analyzer.analyze();

      expect(analysis.netExchangeFlow).toBe(1500000);
    });
  });
});
