import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import * as http from 'http';

export class MetricsService {
  private registry: Registry;
  private server: http.Server | null = null;

  // Transaction metrics
  public txTotal: Counter;
  public txValueUsd: Histogram;
  public txFetchDuration: Histogram;

  // Whale metrics
  public whaleDetected: Counter;
  public whalePurchaseTotal: Counter;

  // Exchange flow metrics
  public exchangeInflow: Counter;
  public exchangeOutflow: Counter;

  // System metrics
  public chainHealth: Gauge;
  public pollDuration: Histogram;
  public cacheHits: Counter;
  public cacheMisses: Counter;
  // P3-12: Price fetch metrics
  public priceMisses: Counter;

  constructor() {
    this.registry = new Registry();

    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register: this.registry });

    // Initialize metrics
    this.txTotal = new Counter({
      name: 'onchain_transactions_total',
      help: 'Total number of transactions processed',
      labelNames: ['chain_id', 'chain_name', 'type'],
      registers: [this.registry],
    });

    this.txValueUsd = new Histogram({
      name: 'onchain_transaction_value_usd',
      help: 'Transaction value in USD',
      labelNames: ['chain_id', 'type'],
      buckets: [10000, 50000, 100000, 500000, 1000000, 5000000, 10000000],
      registers: [this.registry],
    });

    this.txFetchDuration = new Histogram({
      name: 'onchain_tx_fetch_duration_seconds',
      help: 'Duration of transaction fetching',
      labelNames: ['chain_id'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });

    this.whaleDetected = new Counter({
      name: 'onchain_whale_detected_total',
      help: 'Total number of whale transactions detected',
      labelNames: ['chain_id', 'token'],
      registers: [this.registry],
    });

    this.whalePurchaseTotal = new Counter({
      name: 'onchain_whale_purchase_total',
      help: 'Total number of whale token purchases',
      labelNames: ['chain_id', 'token'],
      registers: [this.registry],
    });

    this.exchangeInflow = new Counter({
      name: 'onchain_exchange_inflow_usd_total',
      help: 'Total USD value flowing into exchanges',
      labelNames: ['chain_id', 'exchange'],
      registers: [this.registry],
    });

    this.exchangeOutflow = new Counter({
      name: 'onchain_exchange_outflow_usd_total',
      help: 'Total USD value flowing out of exchanges',
      labelNames: ['chain_id', 'exchange'],
      registers: [this.registry],
    });

    this.chainHealth = new Gauge({
      name: 'onchain_chain_health',
      help: 'Health status of chain connection (1 = healthy, 0 = unhealthy)',
      labelNames: ['chain_id', 'chain_name'],
      registers: [this.registry],
    });

    this.pollDuration = new Histogram({
      name: 'onchain_poll_duration_seconds',
      help: 'Duration of polling cycle',
      labelNames: ['chain_id'],
      buckets: [1, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });

    this.cacheHits = new Counter({
      name: 'onchain_cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_type'],
      registers: [this.registry],
    });

    this.cacheMisses = new Counter({
      name: 'onchain_cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_type'],
      registers: [this.registry],
    });

    // P3-12: Price fetch miss counter
    this.priceMisses = new Counter({
      name: 'onchain_price_misses_total',
      help: 'Total number of failed price fetches (returned 0)',
      labelNames: ['chain_id', 'token'],
      registers: [this.registry],
    });
  }

  startServer(port: number = 9090): void {
    this.server = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', this.registry.contentType);
        res.end(await this.registry.metrics());
      } else if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      } else {
        res.statusCode = 404;
        res.end('Not found');
      }
    });

    this.server.listen(port, () => {
      console.log(`[Metrics] Prometheus metrics available at http://localhost:${port}/metrics`);
    });
  }

  async stopServer(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  async getJsonMetrics(): Promise<any> {
    return this.registry.getMetricsAsJSON();
  }
}

// Singleton instance
export const metrics = new MetricsService();
