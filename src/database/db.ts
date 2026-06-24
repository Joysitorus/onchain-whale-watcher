import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '../config';
import { MarketSignal, MonitoredTransfer, Transaction, WhaleTokenPurchase } from '../types';

export class Database {
  private pool: Pool | null = null;
  private connected: boolean = false;

  constructor() {
    if (config.databaseUrl) {
      this.pool = new Pool({
        connectionString: config.databaseUrl,
        ssl: { rejectUnauthorized: false },
        max: 5,
      });

      this.pool.on('error', (err) => {
        console.error('[DB] Pool error:', err.message);
      });
    }
  }

  async connect(): Promise<void> {
    if (!this.pool) {
      console.warn('[DB] No DATABASE_URL configured, running without database...');
      return;
    }
    try {
      const client = await this.pool.connect();
      console.log('[DB] Connected to PostgreSQL');
      client.release();
      await this.runMigrations();
      this.connected = true;
    } catch (err: any) {
      console.warn('[DB] Connection failed:', err.message);
      console.warn('[DB] Running without database...');
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS monitored_transfers (
          id SERIAL PRIMARY KEY,
          hash VARCHAR(255),
          chain_id INTEGER NOT NULL,
          chain_name VARCHAR(50),
          from_address VARCHAR(255) NOT NULL,
          from_label VARCHAR(255),
          from_type VARCHAR(50),
          to_address VARCHAR(255) NOT NULL,
          to_label VARCHAR(255),
          to_type VARCHAR(50),
          value_usd NUMERIC(20, 2) NOT NULL,
          token VARCHAR(50),
          significance VARCHAR(20),
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(hash, chain_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS market_signals (
          id SERIAL PRIMARY KEY,
          direction VARCHAR(20) NOT NULL,
          confidence INTEGER NOT NULL,
          reason TEXT,
          exchange_inflow NUMERIC(20, 2) DEFAULT 0,
          exchange_outflow NUMERIC(20, 2) DEFAULT 0,
          whale_accumulation NUMERIC(20, 2) DEFAULT 0,
          whale_distribution NUMERIC(20, 2) DEFAULT 0,
          net_exchange_flow NUMERIC(20, 2) DEFAULT 0,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS known_addresses (
          id SERIAL PRIMARY KEY,
          address VARCHAR(255) NOT NULL,
          chain_id INTEGER NOT NULL,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL,
          source VARCHAR(50) DEFAULT 'manual',
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(address, chain_id)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_transfers_timestamp ON monitored_transfers(timestamp)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS whale_tracking (
          id SERIAL PRIMARY KEY,
          address VARCHAR(255) NOT NULL,
          chain_id INTEGER NOT NULL,
          label VARCHAR(255),
          first_seen_tx VARCHAR(255),
          first_seen_value NUMERIC(20, 2),
          first_seen_timestamp BIGINT,
          total_tx_count INTEGER DEFAULT 0,
          total_volume_usd NUMERIC(20, 2) DEFAULT 0,
          last_active BIGINT,
          status VARCHAR(20) DEFAULT 'active',
          holdings_usd NUMERIC(20, 2) DEFAULT 0,
          previous_percentage NUMERIC(10, 8) DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(address, chain_id)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON market_signals(timestamp)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_whale_status ON whale_tracking(status)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS whale_token_purchases (
          id SERIAL PRIMARY KEY,
          hash VARCHAR(255) NOT NULL,
          chain_id INTEGER NOT NULL,
          chain_name VARCHAR(50),
          token_address VARCHAR(255) NOT NULL,
          token_symbol VARCHAR(20),
          token_name VARCHAR(255),
          token_decimals INTEGER DEFAULT 18,
          amount VARCHAR(100),
          amount_usd NUMERIC(20, 2),
          whale_address VARCHAR(255) NOT NULL,
          whale_label VARCHAR(255),
          whale_type VARCHAR(50),
          counterparty VARCHAR(255),
          counterparty_label VARCHAR(255),
          counterparty_type VARCHAR(50),
          direction VARCHAR(10),
          block_number BIGINT,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(hash, chain_id, token_address)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_token_purchases_timestamp ON whale_token_purchases(timestamp)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_token_purchases_whale ON whale_token_purchases(whale_address)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_token_purchases_token ON whale_token_purchases(token_address, chain_id)
      `);

      await client.query('COMMIT');
      console.log('[DB] Migrations completed');
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error('[DB] Migration failed:', err.message);
    } finally {
      client.release();
    }
  }

  async saveTransfer(transfer: MonitoredTransfer): Promise<void> {
    if (!this.connected || !this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO monitored_transfers
         (hash, chain_id, chain_name, from_address, from_label, from_type,
          to_address, to_label, to_type, value_usd, significance, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT DO NOTHING`,
        [
          transfer.hash,
          transfer.chainId,
          transfer.chainName,
          transfer.from,
          transfer.fromLabel,
          transfer.fromType,
          transfer.to,
          transfer.toLabel,
          transfer.toType,
          transfer.valueUsd,
          transfer.significance,
          transfer.timestamp,
        ]
      );
    } catch (err: any) {
      console.warn('[DB] Failed to save transfer:', err.message);
    }
  }

  async saveTransfers(transfers: MonitoredTransfer[]): Promise<void> {
    if (!this.connected || !this.pool || transfers.length === 0) return;

    const BATCH_SIZE = 100;
    
    for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
      const batch = transfers.slice(i, i + BATCH_SIZE);
      
      try {
        const values: any[] = [];
        const placeholders = batch.map((tx, idx) => {
          const base = idx * 12;
          values.push(
            tx.hash,
            tx.chainId,
            tx.chainName,
            tx.from,
            tx.fromLabel,
            tx.fromType,
            tx.to,
            tx.toLabel,
            tx.toType,
            tx.valueUsd,
            tx.significance,
            tx.timestamp,
          );
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12})`;
        }).join(',');

        await this.pool.query(
          `INSERT INTO monitored_transfers
           (hash, chain_id, chain_name, from_address, from_label, from_type,
            to_address, to_label, to_type, value_usd, significance, timestamp)
           VALUES ${placeholders}
           ON CONFLICT (hash, chain_id) DO NOTHING`,
          values
        );
      } catch (err: any) {
        console.warn('[DB] Failed to save transfers batch:', err.message);
      }
    }
  }

  async saveSignal(signal: MarketSignal, analysis: any): Promise<void> {
    if (!this.connected || !this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO market_signals
         (direction, confidence, reason, exchange_inflow, exchange_outflow,
          whale_accumulation, whale_distribution, net_exchange_flow, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          signal.direction,
          signal.confidence,
          signal.reason,
          analysis?.exchangeInflow || 0,
          analysis?.exchangeOutflow || 0,
          analysis?.whaleAccumulation || 0,
          analysis?.whaleDistribution || 0,
          analysis?.netExchangeFlow || 0,
          signal.timestamp,
        ]
      );
    } catch (err: any) {
      console.warn('[DB] Failed to save signal:', err.message);
    }
  }

  async upsertAddress(
    address: string,
    chainId: number,
    name: string,
    type: string,
    source: string = 'manual'
  ): Promise<void> {
    if (!this.connected || !this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO known_addresses (address, chain_id, name, type, source)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (address, chain_id)
         DO UPDATE SET name = $3, type = $4, source = $5`,
        [address.toLowerCase(), chainId, name, type, source]
      );
    } catch (err: any) {
      console.warn('[DB] Failed to upsert address:', err.message);
    }
  }

  async getRecentTransfers(limit: number = 20): Promise<MonitoredTransfer[]> {
    if (!this.connected || !this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT * FROM monitored_transfers
         ORDER BY timestamp DESC LIMIT $1`,
        [limit]
      );
      return result.rows.map(this.mapTransferRow);
    } catch {
      return [];
    }
  }

  async getRecentSignals(limit: number = 10): Promise<any[]> {
    if (!this.connected || !this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT * FROM market_signals ORDER BY timestamp DESC LIMIT $1`,
        [limit]
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  async getTotalTrackedValue(): Promise<number> {
    if (!this.connected || !this.pool) return 0;
    try {
      const result = await this.pool.query(
        `SELECT COALESCE(SUM(value_usd), 0) as total FROM monitored_transfers`
      );
      return parseFloat(result.rows[0]?.total || '0');
    } catch {
      return 0;
    }
  }

  async upsertWhale(
    address: string,
    chainId: number,
    data: {
      label?: string;
      hash?: string;
      valueUsd?: number;
      timestamp?: number;
    }
  ): Promise<void> {
    if (!this.connected || !this.pool) return;
    try {
      // Use atomic INSERT ... ON CONFLICT DO UPDATE to prevent race conditions
      await this.pool.query(
        `INSERT INTO whale_tracking
         (address, chain_id, label, first_seen_tx, first_seen_value, first_seen_timestamp,
          total_tx_count, total_volume_usd, last_active, status)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,'active')
         ON CONFLICT (address, chain_id)
         DO UPDATE SET
           total_tx_count = whale_tracking.total_tx_count + 1,
           total_volume_usd = whale_tracking.total_volume_usd + EXCLUDED.total_volume_usd,
           last_active = EXCLUDED.last_active,
           status = 'active',
           updated_at = NOW()`,
        [
          address.toLowerCase(),
          chainId,
          data.label || null,
          data.hash || null,
          data.valueUsd || null,
          data.timestamp || null,
          data.valueUsd || 0,
          data.timestamp || null,
        ]
      );
    } catch (err: any) {
      console.warn('[DB] Failed to upsert whale:', err.message);
    }
  }

  async getTrackedWhales(limit: number = 20): Promise<any[]> {
    if (!this.connected || !this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT * FROM whale_tracking WHERE status = 'active'
         ORDER BY total_volume_usd DESC LIMIT $1`,
        [limit]
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  async getWhaleState(address: string, chainId: number): Promise<{ holdingsUsd: number; previousPercentage: number } | null> {
    if (!this.connected || !this.pool) return null;
    try {
      const result = await this.pool.query(
        `SELECT holdings_usd, previous_percentage FROM whale_tracking
         WHERE address = $1 AND chain_id = $2`,
        [address.toLowerCase(), chainId]
      );
      if (result.rows.length > 0) {
        return {
          holdingsUsd: parseFloat(result.rows[0].holdings_usd) || 0,
          previousPercentage: parseFloat(result.rows[0].previous_percentage) || 0,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async updateWhaleState(address: string, chainId: number, holdingsUsd: number, previousPercentage: number): Promise<void> {
    if (!this.connected || !this.pool) return;
    try {
      await this.pool.query(
        `UPDATE whale_tracking SET
         holdings_usd = $3,
         previous_percentage = $4,
         updated_at = NOW()
         WHERE address = $1 AND chain_id = $2`,
        [address.toLowerCase(), chainId, holdingsUsd, previousPercentage]
      );
    } catch (err: any) {
      console.warn('[DB] Failed to update whale state:', err.message);
    }
  }

  async getWhaleHistory(address: string, chainId: number): Promise<MonitoredTransfer[]> {
    if (!this.connected || !this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT * FROM monitored_transfers
         WHERE (from_address = $1 OR to_address = $1) AND chain_id = $2
         ORDER BY timestamp DESC LIMIT 50`,
        [address.toLowerCase(), chainId]
      );
      return result.rows.map(this.mapTransferRow);
    } catch {
      return [];
    }
  }

  async saveTokenPurchase(purchase: WhaleTokenPurchase): Promise<void> {
    if (!this.connected || !this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO whale_token_purchases
         (hash, chain_id, chain_name, token_address, token_symbol, token_name,
          token_decimals, amount, amount_usd, whale_address, whale_label,
          whale_type, counterparty, counterparty_label, counterparty_type,
          direction, block_number, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT DO NOTHING`,
        [
          purchase.hash,
          purchase.chainId,
          purchase.chainName,
          purchase.tokenAddress,
          purchase.tokenSymbol,
          purchase.tokenName,
          purchase.tokenDecimals,
          purchase.amount,
          purchase.amountUsd,
          purchase.whaleAddress.toLowerCase(),
          purchase.whaleLabel,
          purchase.whaleType,
          purchase.counterparty,
          purchase.counterpartyLabel,
          purchase.counterpartyType,
          purchase.direction,
          purchase.blockNumber,
          purchase.timestamp,
        ]
      );
    } catch (err: any) {
      console.warn('[DB] Failed to save token purchase:', err.message);
    }
  }

  async saveTokenPurchases(purchases: WhaleTokenPurchase[]): Promise<void> {
    if (!this.connected || !this.pool || purchases.length === 0) return;

    const BATCH_SIZE = 100;
    
    for (let i = 0; i < purchases.length; i += BATCH_SIZE) {
      const batch = purchases.slice(i, i + BATCH_SIZE);
      
      try {
        const values: any[] = [];
        const placeholders = batch.map((p, idx) => {
          const base = idx * 18;
          values.push(
            p.hash,
            p.chainId,
            p.chainName,
            p.tokenAddress,
            p.tokenSymbol,
            p.tokenName,
            p.tokenDecimals,
            p.amount,
            p.amountUsd,
            p.whaleAddress.toLowerCase(),
            p.whaleLabel,
            p.whaleType,
            p.counterparty,
            p.counterpartyLabel,
            p.counterpartyType,
            p.direction,
            p.blockNumber,
            p.timestamp,
          );
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18})`;
        }).join(',');

        await this.pool.query(
          `INSERT INTO whale_token_purchases
           (hash, chain_id, chain_name, token_address, token_symbol, token_name,
            token_decimals, amount, amount_usd, whale_address, whale_label,
            whale_type, counterparty, counterparty_label, counterparty_type,
            direction, block_number, timestamp)
           VALUES ${placeholders}
           ON CONFLICT (hash, chain_id, token_address) DO NOTHING`,
          values
        );
      } catch (err: any) {
        console.warn('[DB] Failed to save token purchases batch:', err.message);
      }
    }
  }

  async getRecentTokenPurchases(limit: number = 50): Promise<WhaleTokenPurchase[]> {
    if (!this.connected || !this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT * FROM whale_token_purchases
         ORDER BY timestamp DESC LIMIT $1`,
        [limit]
      );
      return result.rows.map(this.mapTokenPurchaseRow);
    } catch {
      return [];
    }
  }

  async getTokenPurchasesByToken(tokenAddress: string, chainId: number, limit: number = 50): Promise<WhaleTokenPurchase[]> {
    if (!this.connected || !this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT * FROM whale_token_purchases
         WHERE token_address = $1 AND chain_id = $2
         ORDER BY timestamp DESC LIMIT $3`,
        [tokenAddress.toLowerCase(), chainId, limit]
      );
      return result.rows.map(this.mapTokenPurchaseRow);
    } catch {
      return [];
    }
  }

  async getTokenPurchasesByWhale(whaleAddress: string, limit: number = 50): Promise<WhaleTokenPurchase[]> {
    if (!this.connected || !this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT * FROM whale_token_purchases
         WHERE whale_address = $1
         ORDER BY timestamp DESC LIMIT $2`,
        [whaleAddress.toLowerCase(), limit]
      );
      return result.rows.map(this.mapTokenPurchaseRow);
    } catch {
      return [];
    }
  }

  async getTopAccumulatedTokens(chainId?: number, limit: number = 10): Promise<any[]> {
    if (!this.connected || !this.pool) return [];
    try {
      let query = `
        SELECT token_address, token_symbol, token_name, chain_id, chain_name,
               SUM(CASE WHEN direction = 'buy' THEN amount_usd ELSE 0 END) as total_bought,
               SUM(CASE WHEN direction = 'sell' THEN amount_usd ELSE 0 END) as total_sold,
               COUNT(DISTINCT whale_address) as unique_whales,
               SUM(amount_usd) as total_volume
        FROM whale_token_purchases
      `;
      const params: any[] = [];
      if (chainId) {
        query += ' WHERE chain_id = $1';
        params.push(chainId);
      }
      query += `
        GROUP BY token_address, token_symbol, token_name, chain_id, chain_name
        HAVING SUM(CASE WHEN direction = 'buy' THEN amount_usd ELSE 0 END) >
               SUM(CASE WHEN direction = 'sell' THEN amount_usd ELSE 0 END)
        ORDER BY total_bought DESC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);
      const result = await this.pool.query(query, params);
      return result.rows;
    } catch {
      return [];
    }
  }

  private mapTokenPurchaseRow(row: any): WhaleTokenPurchase {
    return {
      hash: row.hash,
      chainId: row.chain_id,
      chainName: row.chain_name,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      tokenName: row.token_name,
      tokenDecimals: row.token_decimals,
      amount: row.amount,
      amountUsd: parseFloat(row.amount_usd),
      whaleAddress: row.whale_address,
      whaleLabel: row.whale_label,
      whaleType: row.whale_type,
      counterparty: row.counterparty,
      counterpartyLabel: row.counterparty_label,
      counterpartyType: row.counterparty_type,
      timestamp: row.timestamp,
      blockNumber: row.block_number,
      direction: row.direction,
    };
  }

  private mapTransferRow(row: any): MonitoredTransfer {
    return {
      hash: row.hash,
      chainId: row.chain_id,
      chainName: row.chain_name,
      from: row.from_address,
      fromLabel: row.from_label,
      fromType: row.from_type,
      to: row.to_address,
      toLabel: row.to_label,
      toType: row.to_type,
      valueUsd: parseFloat(row.value_usd),
      token: row.token || 'ETH',
      significance: row.significance,
      timestamp: row.timestamp,
    };
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      console.log('[DB] Disconnected');
    }
  }
}
