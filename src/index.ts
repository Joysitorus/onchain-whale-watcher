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

  // Save scraped entities to DB
  for (const entity of entities) {
    await db.upsertAddress(entity.address, 1, entity.name, entity.entityType, 'arkham');
  }

  console.log('[Init] Starting monitoring loop...\n');

  async function poll() {
    const allTransfers: MonitoredTransfer[] = [];
    let pollStartTime = Date.now();

    // Step 1: Follow-up on previously tracked whales
    console.log(`[Poll] ${new Date().toLocaleTimeString()} - Checking tracked whales...`);
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
      allTransfers.push(...pending);
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

    // Step 8: Generate signals (combine standard + whale signals)
    const signal = signalGen.generate(analysis, allTransfers);
    const whaleSignal = whaleTracker.generateWhaleSignal(allTransfers);

    // Step 9: Save signal to database
    await db.saveSignal(signal, analysis);

    // Step 10: Report to console
    consoleReporter.reportTransfers(allTransfers);
    if (newWhales.length > 0) {
      console.log(`\n[WhaleTracker] ${newWhales.length} new unknown whale(s) identified and being tracked`);
    }
    consoleReporter.reportAnalysis(analysis);
    consoleReporter.reportSignal(signal);

    // Step 11: Send Telegram notifications
    if (telegramReporter) {
      // New whale alerts (highest priority)
      for (const tx of newWhales) {
        await telegramReporter.sendNewWhaleAlert(tx);
      }

      // Whale exchange movement alerts
      for (const tx of exchangeMovements) {
        await telegramReporter.sendAlert(tx);
      }

      // Critical transfers
      const criticalTransfers = allTransfers.filter(tx => tx.significance === 'critical');
      for (const tx of criticalTransfers) {
        await telegramReporter.sendAlert(tx);
      }

      // Whale signal (if any)
      if (whaleSignal) {
        await telegramReporter.sendSignal(whaleSignal, analysis);
      }

      // Standard market signal
      await telegramReporter.sendSignal(signal, analysis);

      // Summary
      const totalValue = allTransfers.reduce((sum, tx) => sum + tx.valueUsd, 0);
      await telegramReporter.sendSummary(allTransfers.length, totalValue, signal);

      // Whale summary
      if (newWhales.length > 0) {
        const newWhaleVolume = newWhales.reduce((s, t) => s + t.valueUsd, 0);
        await telegramReporter.sendWhaleSummary(newWhales.length, newWhaleVolume);
      }
    }

    const pollDuration = Date.now() - pollStartTime;
    console.log(`[Poll] Completed in ${(pollDuration / 1000).toFixed(1)}s`);
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
