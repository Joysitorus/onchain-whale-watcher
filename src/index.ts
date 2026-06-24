import { config } from './config';
import { LabelDatabase } from './label-db';
import { ArkhamScraper } from './scrapers/arkham-scraper';
import { RpcFetcher } from './fetchers/rpc-fetcher';
import { TokenTransferFetcher } from './fetchers/token-transfer-fetcher';
import { TransactionAnalyzer } from './analyzers/transaction-analyzer';
import { WhaleTracker } from './analyzers/whale-tracker';
import { TokenPurchaseDetector } from './analyzers/token-purchase-detector';
import { TokenRegistry } from './tokens/token-registry';
import { SignalGenerator } from './signals/signal-generator';
import { ConsoleReporter } from './reporters/console-reporter';
import { TelegramReporter } from './reporters/telegram-reporter';
import { Database } from './database/db';
import { NotificationManager } from './notifications/notification-manager';
import { MonitoredTransfer, WhaleTokenPurchase } from './types';
import { CacheService } from './cache/cache-service';
import { HybridConnectionManager } from './fetchers/hybrid-connection';
import { QueueService } from './queue/queue-service';
import { metrics } from './metrics/metrics-service';
import { rpcProviderManager } from './fetchers/rpc-provider-manager';

async function main() {
  console.log('=== On-Chain Activity Agent ===');
  console.log(`Monitoring chains: ${config.chains.map(c => c.name).join(', ')}`);
  console.log(`Min transaction value: $${config.minTxValueUsd.toLocaleString()}`);
  console.log(`Poll interval: ${config.pollIntervalMs / 1000}s`);
  console.log(`Redis cache: ${config.cacheEnabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Connection mode: ${config.enableWebSocket ? 'HYBRID (WS + Polling)' : 'POLLING ONLY'}`);
  console.log(`Job Queue: ${config.enableJobQueue ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Metrics: ${config.metricsEnabled ? 'ENABLED' : 'DISABLED'}\n`);

  // Init core modules
  const labelDb = new LabelDatabase();
  const arkhamScraper = new ArkhamScraper(labelDb);
  const rpcFetcher = new RpcFetcher(labelDb);
  const analyzer = new TransactionAnalyzer(labelDb);
  const signalGen = new SignalGenerator();
  const consoleReporter = new ConsoleReporter();
  const notifyManager = new NotificationManager();

  // Init new services
  const cacheService = new CacheService();
  const hybridConn = new HybridConnectionManager();
  const queueService = new QueueService();

  // Start metrics server
  if (config.metricsEnabled) {
    metrics.startServer(config.metricsPort);
  }

  // Init token registry
  const rpcUrls = new Map<number, string>();
  for (const chain of config.chains) {
    if (chain.rpcUrl) rpcUrls.set(chain.chainId, chain.rpcUrl);
  }
  const tokenRegistry = new TokenRegistry(rpcUrls);
  const tokenTransferFetcher = new TokenTransferFetcher(tokenRegistry, labelDb);

  // Init database
  const db = new Database();
  await db.connect();

  // Use single database instance for all components
  const tokenPurchaseDetector = new TokenPurchaseDetector(labelDb, db);

  // Init whale tracker
  const whaleTracker = new WhaleTracker(labelDb, db, rpcFetcher);

  // Start hybrid connection manager
  await hybridConn.start();

  // Log connection health status
  const healthStatus = hybridConn.getHealthStatus();
  for (const health of healthStatus) {
    const chain = config.chains.find(c => c.chainId === health.chainId);
    console.log(`[${chain?.name}] Mode: ${health.mode} | Connected: ${health.connected}`);
  }

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
  const defaultChainId = config.chains[0]?.chainId || 1;
  for (const entity of entities) {
    await db.upsertAddress(entity.address, defaultChainId, entity.name, entity.entityType, 'arkham');
  }

  // Register job queue workers
  if (config.enableJobQueue) {
    queueService.registerWorker('whale-transactions', async (job) => {
      const { transfers } = job.data;
      await db.saveTransfers(transfers);
      return { success: true, processed: transfers.length };
    });

    queueService.registerWorker('token-purchases', async (job) => {
      const { purchases } = job.data;
      tokenPurchaseDetector.addPurchases(purchases);
      return { success: true, processed: purchases.length };
    });
  }

  console.log('[Init] Starting monitoring loop...\n');

  // Poll concurrency guard - prevents overlapping poll cycles
  let isPolling = false;

  // P2-14: Poll timeout to prevent zombie state
  const POLL_TIMEOUT_MS = parseInt(process.env.POLL_TIMEOUT_MS || '120000', 10); // 2 minutes default

  async function poll() {
    // Prevent concurrent poll execution
    if (isPolling) {
      console.log('[Poll] Previous cycle still running, skipping this tick');
      return;
    }
    isPolling = true;

    const allTransfers: MonitoredTransfer[] = [];
    const pollStartTime = Date.now();
    const pollTimer = metrics.pollDuration.startTimer({ chain_id: 'all' });

    // P2-14: Set up timeout to prevent zombie state
    const pollTimeout = setTimeout(() => {
      console.error(`[Poll] TIMEOUT after ${POLL_TIMEOUT_MS / 1000}s - forcing poll cycle to end`);
      isPolling = false;
    }, POLL_TIMEOUT_MS);

    try {
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

      // Cache RPC blocks for 15 seconds
      const blockCacheKey = `blocks_${chain.chainId}`;
      const txs = await cacheService.getOrSet(
        blockCacheKey,
        () => rpcFetcher.getLatestBlocks(chain, 3),
        15000
      );
      
      for (const tx of txs || []) {
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
          token: chain.nativeToken,
          timestamp: tx.timestamp,
          blockNumber: tx.blockNumber || 0,
          significance: tx.valueUsd >= 10_000_000 ? 'critical' : tx.valueUsd >= 1_000_000 ? 'high' : 'medium',
        });
      }

      const pending = await rpcFetcher.getPendingTransactions(chain);
      for (const ptx of pending) {
        if (ptx.valueUsd < config.minTxValueUsd) continue;
        allTransfers.push(ptx);
      }

      // Step 3b: Fetch ERC-20 token transfers (with cache)
      try {
        const cacheKey = `token_transfers_${chain.chainId}`;
        const fetchTimer = metrics.txFetchDuration.startTimer({ chain_id: chain.chainId.toString() });
        
        let tokenPurchases = await cacheService.getOrSet(
          cacheKey,
          () => tokenTransferFetcher.fetchRecentPurchases(chain, 100),
          30000 // 30 seconds cache
        );
        
        fetchTimer();
        
        if (tokenPurchases && tokenPurchases.length > 0) {
          tokenPurchaseDetector.addPurchases(tokenPurchases);
          metrics.cacheHits.inc({ cache_type: 'token_transfers' });
          console.log(`[TokenFetcher] ${tokenPurchases.length} token transfers detected on ${chain.name}`);
        } else {
          metrics.cacheMisses.inc({ cache_type: 'token_transfers' });
        }
        
        // Add to job queue if enabled
        if (config.enableJobQueue && tokenPurchases && tokenPurchases.length > 0) {
          await queueService.addJob('token-purchases', {
            type: 'process',
            payload: { purchases: tokenPurchases },
          });
        }
      } catch (err: any) {
        console.warn(`[TokenFetcher] Error on ${chain.name}: ${err.message}`);
      }
    }

    // Step 3c: Detect whale token purchases from native transfers
    const whaleTokenPurchases = tokenPurchaseDetector.detectWhaleTokenPurchases(allTransfers);
    tokenPurchaseDetector.addPurchases(whaleTokenPurchases);

    if (allTransfers.length === 0 && whaleTokenPurchases.length === 0) {
      console.log(`[${new Date().toLocaleTimeString()}] No significant transfers detected`);
      return;
    }

    // Step 4: Identify new unknown whales
    const newWhales = await whaleTracker.identifyNewWhales(allTransfers);

    // Step 5: Detect whale-to-exchange movements
    const exchangeMovements = await whaleTracker.detectExchangeMovement();

    // Step 6: Save to database (via job queue if enabled)
    if (config.enableJobQueue && allTransfers.length > 0) {
      await queueService.addJob('whale-transactions', {
        type: 'save',
        payload: { transfers: allTransfers },
      });
    } else {
      await db.saveTransfers(allTransfers);
    }

    // Step 7: Analyze
    analyzer.addTransfers(allTransfers);
    const analysis = analyzer.analyze();

    // Step 8: Generate signals
    const signal = signalGen.generate(analysis, allTransfers);
    const whaleSignal = await whaleTracker.generateWhaleSignal(allTransfers);

    // Step 8b: Analyze token purchases
    const tokenSummaries = tokenPurchaseDetector.analyzeTokenPurchases();
    const whaleActivities = tokenPurchaseDetector.analyzeWhaleActivity();
    const topAccumulated = tokenPurchaseDetector.getTopAccumulatedTokens(5);

    if (topAccumulated.length > 0) {
      console.log('\n[TokenDetector] Top tokens being accumulated by whales:');
      for (const t of topAccumulated) {
        const buys = t.purchases.filter(p => p.direction === 'buy').reduce((s, p) => s + p.amountUsd, 0);
        console.log(`  ${t.tokenSymbol} (${t.chainName}) - $${(buys / 1000).toFixed(1)}K bought by ${t.uniqueWhales.size} whale(s)`);
      }
    }

    // Step 9: Save signal to database
    await db.saveSignal(signal, analysis);

    // Step 10: Report to console (always show everything)
    consoleReporter.reportTransfers(allTransfers);
    if (newWhales.length > 0) {
      console.log(`\n[WhaleTracker] ${newWhales.length} new unknown whale(s) identified and being tracked`);
    }
    consoleReporter.reportAnalysis(analysis);
    consoleReporter.reportSignal(signal);

    // Report token purchases
    if (tokenSummaries.length > 0) {
      consoleReporter.reportTokenPurchases(tokenSummaries, whaleActivities);
    }

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

      // Token purchase alerts
      const significantTokenBuys = whaleActivities.filter(a =>
        a.direction === 'accumulating' && a.netPositionUsd >= 100000
      );
      for (const activity of significantTokenBuys) {
        if (!notifyManager.isTransferDuplicate({
          hash: `token-buy-${activity.whaleAddress}-${activity.tokenAddress}-${activity.chainId}`,
          chainId: activity.chainId,
          chainName: activity.chainName,
          from: '',
          fromLabel: '',
          fromType: '',
          to: activity.whaleAddress,
          toLabel: activity.whaleLabel,
          toType: 'whale',
          valueUsd: activity.netPositionUsd,
          token: activity.tokenSymbol,
          timestamp: Date.now(),
          blockNumber: 0,
          significance: 'high',
        })) {
          await telegramReporter.sendTokenPurchaseAlert(activity);
          notifyManager.markTransferSent({
            hash: `token-buy-${activity.whaleAddress}-${activity.tokenAddress}-${activity.chainId}`,
            chainId: activity.chainId,
            chainName: activity.chainName,
            from: '',
            fromLabel: '',
            fromType: '',
            to: activity.whaleAddress,
            toLabel: activity.whaleLabel,
            toType: 'whale',
            valueUsd: activity.netPositionUsd,
            token: activity.tokenSymbol,
            timestamp: Date.now(),
            blockNumber: 0,
            significance: 'high',
          });
        }
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
    
    // Record metrics
    metrics.txTotal.inc({ chain_id: 'all', chain_name: 'all', type: 'transfer' }, allTransfers.length);
    metrics.whaleDetected.inc({ chain_id: 'all', token: 'native' }, newWhales.length);
    
    console.log(`[Poll] Completed in ${(pollDuration / 1000).toFixed(1)}s | Notified: ${stats.deduped} unique txs, ${stats.whalesTracked} whales tracked`);
    
    } catch (err: any) {
      console.error('[Poll] Error during poll cycle:', err.message);
    } finally {
      // P2-14: Clear timeout and reset polling flag
      clearTimeout(pollTimeout);
      isPolling = false;
      pollTimer();
    }
  }

  // Initial poll
  await poll();

  // Schedule polling
  const intervalId = setInterval(poll, config.pollIntervalMs);

  // Health status check every 5 minutes
  const healthIntervalId = setInterval(() => {
    const healthStatus = hybridConn.getHealthStatus();
    console.log('\n[Health] Connection status:');
    for (const health of healthStatus) {
      const chain = config.chains.find(c => c.chainId === health.chainId);
      const lastUpdate = health.lastUpdate > 0 
        ? `${Math.round((Date.now() - health.lastUpdate) / 1000)}s ago`
        : 'never';
      console.log(`  ${chain?.name}: ${health.mode} | Errors: ${health.errorCount} | Last: ${lastUpdate}`);
    }

    // Log WS provider rotation status if enabled
    if (config.rpcProviderRotation && config.infuraKeys.length > 1) {
      const providerStatus = rpcProviderManager.getStatus();
      for (const status of providerStatus) {
        if (status.wsProviders && status.wsProviders.length > 0) {
          const chain = config.chains.find(c => c.chainId === status.chainId);
          const activeWs = status.wsProviders.find(p => !p.inCooldown);
          const cooldownCount = status.wsProviders.filter(p => p.inCooldown).length;
          console.log(`  ${chain?.name} WS: ${status.wsProviders.length} providers | Active: ${activeWs?.name || 'none'} | In cooldown: ${cooldownCount}`);
        }
      }
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  console.log(`\n[Agent] Running. Next poll in ${config.pollIntervalMs / 1000}s. Press Ctrl+C to stop.\n`);

  // P3-2: Unified shutdown handler - prevents duplication
  async function gracefulShutdown(signal: string) {
    console.log(`\n[Agent] Received ${signal}, shutting down...`);
    clearInterval(intervalId);
    clearInterval(healthIntervalId);
    await hybridConn.stop();
    await queueService.disconnect();
    await cacheService.disconnect();
    await metrics.stopServer();
    await db.disconnect();
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// Global error handlers - prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  const msg = err.message || String(err);
  console.error('[FATAL] Uncaught Exception:', msg);

  // WS/HTTP 429 errors are recoverable - just log and continue
  // ethers.js WebSocketProvider can emit these before our error handler is attached
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many Requests')) {
    console.error('[FATAL] Rate limit error (recoverable), continuing...');
    return; // Don't exit - let the provider rotation handle it
  }

  // Network errors are recoverable
  if (msg.includes('ECONNRESET') || msg.includes('EPIPE') || msg.includes('ECONNREFUSED')) {
    console.error('[FATAL] Network error, exiting...');
    process.exit(1);
  }

  // For other errors, log but don't exit immediately
  console.error('[FATAL] Unexpected error, continuing...');
});

process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason);
  // Don't log rate limit rejections - they're handled by provider rotation
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many Requests')) {
    return; // Silent - provider rotation handles this
  }
  console.error('[WARN] Unhandled Rejection:', msg);
});

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
