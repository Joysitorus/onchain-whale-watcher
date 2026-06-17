import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '../config';
import { MarketSignal, MonitoredTransfer, Transaction } from '../types';

export class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });

    this.pool.on('error', (err) => {
      console.error('[DB] Pool error:', err.message);
    });
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      console.log('[DB] Connected to PostgreSQL');
      client.release();
      await this.runMigrations();
    } catch (err: any) {
      console.warn('[DB] Connection failed:', err.message);
      console.warn('[DB] Running without database...');
    }
  }

  private async runMigrations(): Promise<void> {
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
          created_at TIMESTAMP DEFAULT NOW()
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
    for (const tx of transfers) {
      await this.saveTransfer(tx);
    }
  }

  async saveSignal(signal: MarketSignal, analysis: any): Promise<void> {
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
    try {
      const existing = await this.pool.query(
        `SELECT * FROM whale_tracking WHERE address = $1 AND chain_id = $2`,
        [address.toLowerCase(), chainId]
      );

      if (existing.rows.length === 0) {
        await this.pool.query(
          `INSERT INTO whale_tracking
           (address, chain_id, label, first_seen_tx, first_seen_value, first_seen_timestamp,
            total_tx_count, total_volume_usd, last_active, status)
           VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,'active')`,
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
      } else {
        await this.pool.query(
          `UPDATE whale_tracking SET
           total_tx_count = total_tx_count + 1,
           total_volume_usd = total_volume_usd + $3,
           last_active = $4,
           status = 'active',
           updated_at = NOW()
           WHERE address = $1 AND chain_id = $2`,
          [address.toLowerCase(), chainId, data.valueUsd || 0, data.timestamp || null]
        );
      }
    } catch (err: any) {
      console.warn('[DB] Failed to upsert whale:', err.message);
    }
  }

  async getTrackedWhales(limit: number = 20): Promise<any[]> {
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

  async getWhaleHistory(address: string, chainId: number): Promise<MonitoredTransfer[]> {
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
      significance: row.significance,
      timestamp: row.timestamp,
    };
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    console.log('[DB] Disconnected');
  }
}
