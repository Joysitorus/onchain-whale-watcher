import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { MarketSignal, MonitoredTransfer } from '../types';
import { AnalysisResult } from '../analyzers/transaction-analyzer';
import { Database } from '../database/db';

export class TelegramReporter {
  private bot: TelegramBot | null = null;
  private chatId: string;

  constructor(private db: Database) {
    this.chatId = config.telegramChatId;
    if (config.telegramBotToken) {
      this.bot = new TelegramBot(config.telegramBotToken, { polling: false });
    }
  }

  private getDirectionEmoji(dir: string): string {
    switch (dir) {
      case 'bullish': return '\u{1F7E2}'; // green
      case 'bearish': return '\u{1F534}'; // red
      default: return '\u{1F7E1}'; // yellow
    }
  }

  private getSignificanceEmoji(sig: string): string {
    switch (sig) {
      case 'critical': return '\u{1F534}'; // red
      case 'high': return '\u{1F7E0}'; // orange
      case 'medium': return '\u{1F7E1}'; // yellow
      default: return '\u{26AA}'; // white
    }
  }

  async sendStartupMessage(chains: string[]): Promise<void> {
    if (!this.bot) return;
    const msg =
      `\u{1F916} *On-Chain Agent Started*\n\n` +
      `\u{1F310} Monitoring: ${chains.join(', ')}\n` +
      `\u{26A1} Min value: $${(config.minTxValueUsd / 1000).toFixed(0)}K\n` +
      `\u{1F504} Poll: ${config.pollIntervalMs / 1000}s`;

    await this.send(msg);
  }

  async sendSignal(signal: MarketSignal, analysis?: AnalysisResult): Promise<void> {
    if (!this.bot) return;

    const emoji = this.getDirectionEmoji(signal.direction);
    const dirText = signal.direction === 'bullish' ? 'BULLISH' : signal.direction === 'bearish' ? 'BEARISH' : 'NEUTRAL';

    let msg =
      `${emoji} *MARKET SIGNAL: ${dirText}*\n` +
      `Confidence: ${signal.confidence}%\n` +
      `\u{1F4CB} ${signal.reason}\n`;

    if (analysis) {
      msg += `\n\u{1F4CA} *Analysis:*\n`;
      const netFlow = analysis.netExchangeFlow;
      const flowEmoji = netFlow < 0 ? '\u{2B07}' : netFlow > 0 ? '\u{2B06}' : '\u{27A1}';
      msg += `${flowEmoji} Net Exchange Flow: $${(netFlow / 1_000_000).toFixed(2)}M\n`;

      const totalTracked = await this.db.getTotalTrackedValue();
      msg += `\u{1F4B0} Total tracked: $${(totalTracked / 1_000_000).toFixed(2)}M`;
    }

    if (signal.relatedTransfers.length > 0) {
      msg += `\n\n\u{1F50D} *Top Transfers:*\n`;
      for (const tx of signal.relatedTransfers.slice(0, 3)) {
        const sigEmoji = this.getSignificanceEmoji(tx.significance);
        msg += `${sigEmoji} [${tx.chainName}] $${(tx.valueUsd / 1_000_000).toFixed(2)}M\n`;
        msg += `\u{1F464} ${tx.fromLabel} \u{2192} ${tx.toLabel}\n`;
      }
    }

    msg += `\n\u{23F0} ${new Date(signal.timestamp).toLocaleString('id-ID')}`;

    await this.send(msg);
  }

  async sendAlert(transfer: MonitoredTransfer): Promise<void> {
    if (!this.bot) return;

    const sigEmoji = this.getSignificanceEmoji(transfer.significance);
    const alertLabel = transfer.significance === 'critical' ? '\u{1F6A8} CRITICAL ALERT' :
                       transfer.significance === 'high' ? '\u{26A1} HIGH VALUE' : '\u{1F7E1} MEDIUM';

    const msg =
      `${sigEmoji} *${alertLabel}*\n` +
      `\u{1F4B5} $${(transfer.valueUsd / 1_000_000).toFixed(2)}M\n` +
      `\u{1F310} ${transfer.chainName}\n` +
      `\u{1F464} ${transfer.fromLabel} \u{2192} ${transfer.toLabel}\n` +
      (transfer.hash ? `\u{1F517} \`${transfer.hash.slice(0, 10)}...${transfer.hash.slice(-8)}\`\n` : '') +
      `\u{23F0} ${new Date(transfer.timestamp).toLocaleString('id-ID')}`;

    await this.send(msg);
  }

  async sendNewWhaleAlert(transfer: MonitoredTransfer): Promise<void> {
    if (!this.bot) return;

    const isSender = transfer.fromLabel.startsWith('Whale ');
    const whaleLabel = isSender ? transfer.fromLabel : transfer.toLabel;
    const counterparty = isSender ? transfer.toLabel : transfer.fromLabel;

    const msg =
      `\u{1F50D} *NEW WHALE DETECTED*\n` +
      `\u{1F9ED} *${whaleLabel}*\n` +
      `\u{1F4B5} $${(transfer.valueUsd / 1_000_000).toFixed(2)}M on ${transfer.chainName}\n` +
      `\u{2194} ${isSender ? 'Sent to' : 'Received from'}: ${counterparty}\n` +
      (transfer.hash ? `\u{1F517} \`${transfer.hash.slice(0, 10)}...${transfer.hash.slice(-8)}\`\n` : '') +
      `\u{23F0} ${new Date(transfer.timestamp).toLocaleString('id-ID')}\n\n` +
      `\u{1F50C} *Now tracking this address for follow-up activity*`;

    await this.send(msg);
  }

  async sendWhaleSummary(whaleCount: number, totalVolume: number): Promise<void> {
    if (!this.bot) return;

    const msg =
      `\u{1F40B} *Whale Tracking Summary*\n\n` +
      `\u{1F50D} New whales identified: ${whaleCount}\n` +
      `\u{1F4B0} Total unknown whale volume: $${(totalVolume / 1_000_000).toFixed(2)}M\n` +
      `\u{23F0} ${new Date().toLocaleString('id-ID')}`;

    await this.send(msg);
  }

  async sendSummary(totalTransfers: number, totalValue: number, signal: MarketSignal): Promise<void> {
    if (!this.bot) return;

    const msg =
      `\u{1F4CA} *Periodic Summary*\n\n` +
      `\u{1F4E6} Transfers detected: ${totalTransfers}\n` +
      `\u{1F4B5} Total volume: $${(totalValue / 1_000_000).toFixed(2)}M\n` +
      `\u{1F3C6} Signal: ${signal.direction.toUpperCase()} (${signal.confidence}%)\n` +
      `\u{23F0} ${new Date().toLocaleString('id-ID')}`;

    await this.send(msg);
  }

  private async send(message: string): Promise<void> {
    if (!this.bot || !this.chatId) return;
    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
      } as any);
    } catch (err: any) {
      console.warn('[Telegram] Failed to send message:', err.message);
    }
  }
}
