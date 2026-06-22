import { Telegraf } from 'telegraf';
import { config } from '../config';
import { MarketSignal, MonitoredTransfer } from '../types';
import { AnalysisResult } from '../analyzers/transaction-analyzer';
import { Database } from '../database/db';

interface WhaleTokenActivity {
  whaleAddress: string;
  whaleLabel: string;
  chainId: number;
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenName: string;
  totalBoughtUsd: number;
  totalSoldUsd: number;
  netPositionUsd: number;
  direction: 'accumulating' | 'distributing' | 'mixed';
  txCount: number;
}

export class TelegramReporter {
  private bot: Telegraf | null = null;
  private chatId: string;

  constructor(private db: Database) {
    this.chatId = config.telegramChatId;
    if (config.telegramBotToken) {
      this.bot = new Telegraf(config.telegramBotToken);
    }
  }

  private getDirectionEmoji(dir: string): string {
    switch (dir) {
      case 'bullish': return '\uD83D\uDFE2';
      case 'bearish': return '\uD83D\uDD34';
      default: return '\uD83D\uDFE1';
    }
  }

  private getSignificanceEmoji(sig: string): string {
    switch (sig) {
      case 'critical': return '\uD83D\uDD34';
      case 'high': return '\uD83D\uDFE0';
      case 'medium': return '\uD83D\uDFE1';
      default: return '\u26AA';
    }
  }

  async sendStartupMessage(chains: string[]): Promise<void> {
    if (!this.bot) return;
    const msg =
      `\uD83E\uDD16 *On-Chain Agent Started*\n\n` +
      `\uD83C\uDF10 Monitoring: ${chains.join(', ')}\n` +
      `\u26A1 Min value: $${(config.minTxValueUsd / 1000).toFixed(0)}K\n` +
      `\uD83D\uDD04 Poll: ${config.pollIntervalMs / 1000}s`;

    await this.send(msg);
  }

  async sendSignal(signal: MarketSignal, analysis?: AnalysisResult): Promise<void> {
    if (!this.bot) return;

    const emoji = this.getDirectionEmoji(signal.direction);
    const dirText = signal.direction === 'bullish' ? 'BULLISH' : signal.direction === 'bearish' ? 'BEARISH' : 'NEUTRAL';

    let msg =
      `${emoji} *MARKET SIGNAL: ${dirText}*\n` +
      `Confidence: ${signal.confidence}%\n` +
      `\uD83D\uDCCB ${signal.reason}\n`;

    if (analysis) {
      msg += `\n\uD83D\uDCCA *Analysis:*\n`;
      const netFlow = analysis.netExchangeFlow;
      const flowEmoji = netFlow < 0 ? '\u2B07' : netFlow > 0 ? '\u2B06' : '\u27A1';
      msg += `${flowEmoji} Net Exchange Flow: $${(netFlow / 1_000_000).toFixed(2)}M\n`;

      const totalTracked = await this.db.getTotalTrackedValue();
      msg += `\uD83D\uDCB0 Total tracked: $${(totalTracked / 1_000_000).toFixed(2)}M`;
    }

    // Supply Impact section
    if (signal.supplyImpact) {
      const si = signal.supplyImpact;
      const trendEmoji = si.trend === 'accumulating' ? '\uD83D\uDCC8' : si.trend === 'distributing' ? '\uD83D\uDCC9' : '\u27A1';
      const trendText = si.trend === 'accumulating' ? 'MENGUMPULKAN' : si.trend === 'distributing' ? 'MENDISTRIBUSIKAN' : 'STABIL';

      msg += `\n\n\uD83D\uDCA1 *SUPPLY IMPACT ANALYSIS*\n`;
      msg += `\uD83D\uDD17 Wallet: \`${si.walletAddress.slice(0, 6)}...${si.walletAddress.slice(-4)}\`\n`;
      msg += `\uD83C\uDFF7\uFE0F Token: ${si.tokenSymbol} (${si.chainId === 1 ? 'ETH' : si.chainId === 56 ? 'BSC' : 'POLY'})\n`;
      msg += `\uD83D\uDCB0 Holdings: $${(si.holdingsUsd / 1_000_000).toFixed(2)}M\n`;
      msg += `\uD83D\uDCCA Supply: ${si.supplyPercentage.toFixed(6)}% dari total\n`;

      if (si.previousPercentage > 0) {
        msg += `${trendEmoji} Trend: ${trendText} (+${si.changePercent.toFixed(6)}%)\n`;
      }

      // Pump/Dump indicators
      if (si.supplyPercentage > 0.1 && si.trend === 'accumulating') {
        msg += `\u26A0\uFE0F *POTENSIAL PUMP* - Whale menguasai >0.1% supply & terus mengumpulkan!\n`;
      } else if (si.supplyPercentage > 0.05 && si.trend === 'accumulating') {
        msg += `\uD83D\uDD0D *MONITORING* - Akumulasi signifikan terdeteksi\n`;
      } else if (si.trend === 'distributing' && si.changePercent > 0.01) {
        msg += `\u26A0\uFE0F *POTENSIAL DUMP* - Whale mulai menjual!\n`;
      }
    }

    if (signal.relatedTransfers.length > 0) {
      msg += `\n\n\uD83D\uDD0D *Top Transfers:*\n`;
      for (const tx of signal.relatedTransfers.slice(0, 3)) {
        const sigEmoji = this.getSignificanceEmoji(tx.significance);
        msg += `${sigEmoji} [${tx.chainName}] $${(tx.valueUsd / 1_000_000).toFixed(2)}M\n`;
        msg += `\uD83D\uDC64 ${tx.fromLabel} \u2192 ${tx.toLabel}\n`;
      }
    }

    // Token purchases section
    if (signal.tokenPurchases && signal.tokenPurchases.length > 0) {
      msg += `\n\n\uD83D\uDED2 *WHALE TOKEN PURCHASES:*\n`;
      for (const purchase of signal.tokenPurchases.slice(0, 5)) {
        const dirEmoji = purchase.direction === 'buy' ? '\uD83D\uDED2' : '\uD83D\uDEB2';
        msg += `${dirEmoji} ${purchase.tokenSymbol} - $${(purchase.amountUsd / 1000).toFixed(1)}K ${purchase.direction}\n`;
        msg += `   Whale: ${purchase.whaleLabel}\n`;
        msg += `   Chain: ${purchase.chainName}\n`;
      }
    }

    msg += `\n\u23F0 ${new Date(signal.timestamp).toLocaleString('id-ID')}`;

    await this.send(msg);
  }

  async sendAlert(transfer: MonitoredTransfer): Promise<void> {
    if (!this.bot) return;

    const sigEmoji = this.getSignificanceEmoji(transfer.significance);
    const alertLabel = transfer.significance === 'critical' ? '\uD83D\uDEA8 CRITICAL ALERT' :
                       transfer.significance === 'high' ? '\u26A1 HIGH VALUE' : '\uD83D\uDFE1 MEDIUM';

    const msg =
      `${sigEmoji} *${alertLabel}*\n` +
      `\uD83D\uDCB5 $${(transfer.valueUsd / 1_000_000).toFixed(2)}M\n` +
      `\uD83C\uDF10 ${transfer.chainName}\n` +
      `\uD83D\uDC64 ${transfer.fromLabel} \u2192 ${transfer.toLabel}\n` +
      (transfer.hash ? `\uD83D\uDD17 \`${transfer.hash.slice(0, 10)}...${transfer.hash.slice(-8)}\`\n` : '') +
      `\u23F0 ${new Date(transfer.timestamp).toLocaleString('id-ID')}`;

    await this.send(msg);
  }

  async sendNewWhaleAlert(transfer: MonitoredTransfer): Promise<void> {
    if (!this.bot) return;

    const isSender = transfer.fromLabel.startsWith('Whale ');
    const whaleLabel = isSender ? transfer.fromLabel : transfer.toLabel;
    const counterparty = isSender ? transfer.toLabel : transfer.fromLabel;

    const msg =
      `\uD83D\uDD0D *NEW WHALE DETECTED*\n` +
      `\uD83E\uDDED *${whaleLabel}*\n` +
      `\uD83D\uDCB5 $${(transfer.valueUsd / 1_000_000).toFixed(2)}M on ${transfer.chainName}\n` +
      `\u2194 ${isSender ? 'Sent to' : 'Received from'}: ${counterparty}\n` +
      (transfer.hash ? `\uD83D\uDD17 \`${transfer.hash.slice(0, 10)}...${transfer.hash.slice(-8)}\`\n` : '') +
      `\u23F0 ${new Date(transfer.timestamp).toLocaleString('id-ID')}\n\n` +
      `\uD83D\uDD0C *Now tracking this address for follow-up activity*`;

    await this.send(msg);
  }

  async sendWhaleSummary(whaleCount: number, totalVolume: number): Promise<void> {
    if (!this.bot) return;

    const msg =
      `\uD83D\uDC0B *Whale Tracking Summary*\n\n` +
      `\uD83D\uDD0D New whales identified: ${whaleCount}\n` +
      `\uD83D\uDCB0 Total unknown whale volume: $${(totalVolume / 1_000_000).toFixed(2)}M\n` +
      `\u23F0 ${new Date().toLocaleString('id-ID')}`;

    await this.send(msg);
  }

  async sendSummary(totalTransfers: number, totalValue: number, signal: MarketSignal): Promise<void> {
    if (!this.bot) return;

    const msg =
      `\uD83D\uDCCA *Periodic Summary*\n\n` +
      `\uD83D\uDCE6 Transfers detected: ${totalTransfers}\n` +
      `\uD83D\uDCB5 Total volume: $${(totalValue / 1_000_000).toFixed(2)}M\n` +
      `\uD83C\uDFC6 Signal: ${signal.direction.toUpperCase()} (${signal.confidence}%)\n` +
      `\u23F0 ${new Date().toLocaleString('id-ID')}`;

    await this.send(msg);
  }

  async sendTokenPurchaseAlert(activity: WhaleTokenActivity): Promise<void> {
    if (!this.bot) return;

    const dirEmoji = activity.direction === 'accumulating' ? '\uD83D\uDCC8' : '\uD83D\uDCC9';
    const dirText = activity.direction === 'accumulating' ? 'ACCUMULATING' : 'DISTRIBUTING';

    const msg =
      `${dirEmoji} *WHALE TOKEN ACTIVITY*\n\n` +
      `\uD83D\uDC64 Whale: ${activity.whaleLabel}\n` +
      `\uD83C\uDFF7\uFE0F Token: *${activity.tokenSymbol}* (${activity.tokenName})\n` +
      `\uD83C\uDF10 Chain: ${activity.chainName}\n` +
      `\uD83D\uDCB0 Bought: $${(activity.totalBoughtUsd / 1000).toFixed(1)}K\n` +
      `\uD83D\uDEB2 Sold: $${(activity.totalSoldUsd / 1000).toFixed(1)}K\n` +
      `\uD83D\uDCCA Net: $${(Math.abs(activity.netPositionUsd) / 1000).toFixed(1)}K ${dirText}\n` +
      `\uD83D\uDCC1 Contract: \`${activity.tokenAddress.slice(0, 10)}...${activity.tokenAddress.slice(-8)}\`\n` +
      `\u23F0 ${new Date().toLocaleString('id-ID')}\n\n` +
      `\u26A0\uFE0F *Monitoring for further activity*`;

    await this.send(msg);
  }

  private async send(message: string): Promise<void> {
    if (!this.bot || !this.chatId) return;
    try {
      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
      });
    } catch (err: any) {
      console.warn('[Telegram] Failed to send message:', err.message);
    }
  }
}
