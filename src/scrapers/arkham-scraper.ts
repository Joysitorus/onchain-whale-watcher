import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config';
import { LabelDatabase } from '../label-db';
import { ArkhamEntity, MonitoredTransfer } from '../types';

export class ArkhamScraper {
  private baseUrl: string;
  private sessionCookies: string = '';

  constructor(private labelDb: LabelDatabase) {
    this.baseUrl = config.arkhamBaseUrl;
  }

  private async fetchPage(path: string): Promise<string> {
    try {
      const { data } = await axios.get(`${this.baseUrl}${path}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cookie': this.sessionCookies,
        },
        timeout: 15000,
      });
      return data;
    } catch (err: any) {
      console.warn(`[Arkham] Failed to fetch ${path}: ${err.message}`);
      return '';
    }
  }

  async scrapeTopEntities(): Promise<ArkhamEntity[]> {
    const html = await this.fetchPage('/explore/entity');
    if (!html) return [];

    const $ = cheerio.load(html);
    const entities: ArkhamEntity[] = [];

    $('[data-testid="entity-row"]').each((_, el) => {
      try {
        const name = $(el).find('[data-testid="entity-name"]').text().trim();
        const address = $(el).find('[data-testid="entity-address"]').text().trim();
        const tags: string[] = [];
        $(el).find('[data-testid="entity-tag"]').each((__, tagEl) => {
          tags.push($(tagEl).text().trim());
        });

        if (address && name) {
          entities.push({
            address: address.toLowerCase(),
            name,
            entityType: tags[0] || 'unknown',
            chain: 'ethereum',
            firstSeen: '',
            totalValue: 0,
            tags,
          });

          this.labelDb.addArkhamLabel(address.toLowerCase(), {
            name,
            type: this.mapEntityType(tags[0] || ''),
          });
        }
      } catch { }
    });

    console.log(`[Arkham] Scraped ${entities.length} entities`);
    return entities;
  }

  private mapEntityType(type: string): 'cex' | 'dex' | 'market_maker' | 'whale' | 'bridge' | 'lending' {
    const t = type.toLowerCase();
    if (t.includes('exchange') || t.includes('cex')) return 'cex';
    if (t.includes('dex') || t.includes('amm')) return 'dex';
    if (t.includes('market') || t.includes('maker')) return 'market_maker';
    if (t.includes('bridge')) return 'bridge';
    if (t.includes('lending') || t.includes('aave') || t.includes('compound')) return 'lending';
    return 'whale';
  }

  async scrapeRecentTransactions(address: string): Promise<any[]> {
    const html = await this.fetchPage(`/address/${address}`);
    if (!html) return [];

    const $ = cheerio.load(html);
    const txs: any[] = [];

    $('[data-testid="tx-row"]').each((_, el) => {
      try {
        const hash = $(el).find('[data-testid="tx-hash"]').text().trim();
        const value = $(el).find('[data-testid="tx-value"]').text().trim();
        const usdValue = parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
        txs.push({ hash, address, value, usdValue });
      } catch { }
    });

    return txs;
  }

  async scrapeWhaleAlerts(): Promise<MonitoredTransfer[]> {
    const html = await this.fetchPage('/explore/transactions');
    if (!html) return [];

    const $ = cheerio.load(html);
    const alerts: MonitoredTransfer[] = [];

    $('[data-testid="alert-row"]').each((_, el) => {
      try {
        const from = $(el).find('[data-testid="alert-from"]').text().trim().toLowerCase();
        const to = $(el).find('[data-testid="alert-to"]').text().trim().toLowerCase();
        const valueText = $(el).find('[data-testid="alert-value"]').text().trim();
        const hash = $(el).find('[data-testid="alert-hash"]').text().trim();
        const valueUsd = parseFloat(valueText.replace(/[^0-9.]/g, '')) || 0;

        const fromLabel = this.labelDb.label(from, 1);
        const toLabel = this.labelDb.label(to, 1);

        if (valueUsd >= config.minTxValueUsd) {
          alerts.push({
            hash,
            chainId: 1,
            chainName: 'Ethereum',
            from,
            fromLabel,
            fromType: this.labelDb.labelType(from, 1),
            to,
            toLabel,
            toType: this.labelDb.labelType(to, 1),
            valueUsd,
            timestamp: Date.now(),
            significance: this.calcSignificance(valueUsd),
          });
        }
      } catch { }
    });

    console.log(`[Arkham] Scraped ${alerts.length} whale alerts`);
    return alerts;
  }

  private calcSignificance(valueUsd: number): MonitoredTransfer['significance'] {
    if (valueUsd >= 10_000_000) return 'critical';
    if (valueUsd >= 1_000_000) return 'high';
    if (valueUsd >= 100_000) return 'medium';
    return 'low';
  }
}
