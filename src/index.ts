import { config } from './config';
import { LabelDatabase } from './label-db';
import { ArkhamScraper } from './scrapers/arkham-scraper';
import { RpcFetcher } from './fetchers/rpc-fetcher';
import { TransactionAnalyzer } from './analyzers/transaction-analyzer';
import { WhaleTracker } from './analyzers/whale-tracker';
import { SignalGenerator } from './signals/signal-generator';
import { ConsoleReporter } from './reporters/console-reporter';
import { TelegramReporter } from './reporters/telegram-reporter';
import { Database } from './database/db';
import { NotificationManager } from './notifications/notification-manager';
import { MonitoredTransfer } from './types';

async function main() {
  console.log('=== On-Chain Activity Agent ===');
  console.log(`Monitoring chains: ${config.chains.map(c => c.name).join(', ')}`);
  console.log(`Min transaction value: $${config.minTxValueUsd.toLocaleString()}`);
  console.log(`Poll interval: ${config.pollIntervalMs / 1000}s\n`);

  // Init core modules
  const labelDb = new LabelDatabase();
  const arkhamScraper = new ArkhamScraper(labelDb);
  const rpcFetcher = new RpcFetcher(labelDb);
  const analyzer = new TransactionAnalyzer(labelDb);
  const signalGen = new SignalGenerator();
  const consoleReporter = new ConsoleReporter();
  const notifyManager = new NotificationManager();

  // Init database
  const db = new Database();
  await db.connect();

  // Init whale tracker
  const whaleTracker = new WhaleTracker(labelDb, db, rpcFetcher);

  // Init Telegram (if configured)
  const telegramReporter = config.telegramBotToken && config.telegramChatId
    ? new TelegramReporter(db)
    : null;

  if (telegramReporter) {
    console.log('[Telegram] Bot configured');
    await telegramReporter.sendStartupMessage(config.chains.map(c => c.name));
  } else {
    console.log('[Telegram] Not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)');
  }

  console.log('[Init] Scraping Arkham Intelligence for entity labels...');
  const entities = await arkhamScraper.scrapeTopEntities();
  for (const entity of entities) {
    await db.upsertAddress(entity.address, 1, entity.name, entity.entityType, 'arkham');
  }

  console.log('[Init] Starting monitoring loop...\n');

  async function poll() {
    const allTransfers: MonitoredTransfer[] = [];
    let pollStartTime = Date.now();

    // Step 1: Follow-up on previously tracked whales
    const followUpTransfers = await whaleTracker.followUpTrackedWhales();
    allTransfers.push(...followUpTransfers);

    // Step 2: Scrape Arkham for whale alerts
    const arkhamAlerts = await arkhamScraper.scrapeWhaleAlerts();
    allTransfers.push(...arkhamAlerts);

    // Step 3: Fetch from RPC nodes (multi-chain)
    for (const chain of config.chains) {
      if (!chain.rpcUrl) {
        console.warn(`[${chain.name}] No RPC URL configured, skipping`);
        continue;
      }

      const txs = await rpcFetcher.getLatestBlocks(chain, 3);
      for (const tx of txs) {
        if (tx.valueUsd < config.minTxValueUsd) continue;

        allTransfers.push({
          hash: tx.hash,
          chainId: tx.chainId,
          chainName: tx.chainName,
          from: tx.from,
          fromLabel: labelDb.label(tx.from, tx.chainId),
          fromType: labelDb.labelType(tx.from, tx.chainId),
          to: tx.to,
          toLabel: labelDb.label(tx.to, tx.chainId),
          toType: labelDb.labelType(tx.to, tx.chainId),
          valueUsd: tx.valueUsd,
          timestamp: tx.timestamp,
          significance: tx.valueUsd >= 10_000_000 ? 'critical' : tx.valueUsd >= 1_000_000 ? 'high' : 'medium',
        });
      }

      const pending = await rpcFetcher.getPendingTransactions(chain);
      for (const ptx of pending) {
        if (ptx.valueUsd < config.minTxValueUsd) continue;
        allTransfers.push(ptx);
      }
    }

    if (allTransfers.length === 0) {
      console.log(`[${new Date().toLocaleTimeString()}] No significant transfers detected`);
      return;
    }

    // Step 4: Identify new unknown whales
    const newWhales = await whaleTracker.identifyNewWhales(allTransfers);

    // Step 5: Detect whale-to-exchange movements
    const exchangeMovements = await whaleTracker.detectExchangeMovement();

    // Step 6: Save to database
    await db.saveTransfers(allTransfers);

    // Step 7: Analyze
    analyzer.addTransfers(allTransfers);
    const analysis = analyzer.analyze();

    // Step 8: Generate signals
    const signal = signalGen.generate(analysis, allTransfers);
    const whaleSignal = whaleTracker.generateWhaleSignal(allTransfers);

    // Step 9: Save signal to database
    await db.saveSignal(signal, analysis);

    // Step 10: Report to console (always show everything)
    consoleReporter.reportTransfers(allTransfers);
    if (newWhales.length > 0) {
      console.log(`\n[WhaleTracker] ${newWhales.length} new unknown whale(s) identified and being tracked`);
    }
    consoleReporter.reportAnalysis(analysis);
    consoleReporter.reportSignal(signal);

    // Step 11: Send Telegram notifications (filtered + throttled)
    if (telegramReporter) {
      // Only notify for genuinely new whales (not already notified)
      const freshNewWhales = notifyManager.filterNewWhales(newWhales);
      for (const tx of freshNewWhales) {
        await telegramReporter.sendNewWhaleAlert(tx);
      }

      // Mark new whale addresses as notified
      for (const tx of freshNewWhales) {
        const whaleAddr = tx.fromLabel.startsWith('Whale ') ? tx.from : tx.to;
        if (whaleAddr) notifyManager.markWhaleNotified(whaleAddr);
      }

      // Only send critical alerts for NON-duplicate transfers
      const uniqueCritical = notifyManager.filterNewTransfers(
        allTransfers.filter(tx => tx.significance === 'critical')
      );
      for (const tx of uniqueCritical) {
        await telegramReporter.sendAlert(tx);
        notifyManager.markTransferSent(tx);
      }

      // Whale exchange movement alerts (deduplicated)
      const uniqueExchangeMoves = notifyManager.filterNewTransfers(exchangeMovements);
      for (const tx of uniqueExchangeMoves) {
        await telegramReporter.sendAlert(tx);
        notifyManager.markTransferSent(tx);
      }

      // Only send market signal if direction changed or confidence shifted significantly
      if (notifyManager.shouldNotifySignal(signal)) {
        await telegramReporter.sendSignal(signal, analysis);
        notifyManager.updateLastSignal(signal);
      }

      // Whale signal (only if new whales detected and signal is meaningful)
      if (whaleSignal && freshNewWhales.length > 0) {
        await telegramReporter.sendSignal(whaleSignal, analysis);
      }

      // Periodic summary (only if there were meaningful events)
      const hasNewActivity = freshNewWhales.length > 0 || uniqueCritical.length > 0;
      if (hasNewActivity) {
        const totalValue = allTransfers.reduce((sum, tx) => sum + tx.valueUsd, 0);
        await telegramReporter.sendSummary(allTransfers.length, totalValue, signal);
      }

      if (freshNewWhales.length > 0) {
        const newWhaleVolume = freshNewWhales.reduce((s, t) => s + t.valueUsd, 0);
        await telegramReporter.sendWhaleSummary(freshNewWhales.length, newWhaleVolume);
      }
    }

    const stats = notifyManager.getStats();
    const pollDuration = Date.now() - pollStartTime;
    console.log(`[Poll] Completed in ${(pollDuration / 1000).toFixed(1)}s | Notified: ${stats.deduped} unique txs, ${stats.whalesTracked} whales tracked`);
  }

  // Initial poll
  await poll();

  // Schedule polling
  const intervalId = setInterval(poll, config.pollIntervalMs);

  console.log(`\n[Agent] Running. Next poll in ${config.pollIntervalMs / 1000}s. Press Ctrl+C to stop.\n`);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Agent] Shutting down...');
    clearInterval(intervalId);
    await db.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Agent] Shutting down...');
    clearInterval(intervalId);
    await db.disconnect();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
