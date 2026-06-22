# AGENTS.md

## Project Overview

On-Chain Activity Agent - Agent untuk memonitor transaksi on-chain multi-chain, menganalisis pergerakan whale, melacak token purchases berdasarkan contract address, serta menghasilkan sinyal arah market (bullish/bearish/neutral) dengan notifikasi via Telegram.

## Commands

```bash
# Development mode (auto-restart)
npm run dev

# Build TypeScript
npm run build

# Production mode
npm start
```

## Project Structure

```
src/
├── index.ts                       # Entry point & polling loop
├── config.ts                      # Multi-chain configuration
├── label-db.ts                    # Address labeling engine
├── types.ts                       # Type definitions
├── analyzers/
│   ├── transaction-analyzer.ts    # Exchange flow, whale movement & transfer direction analysis
│   ├── whale-tracker.ts           # New whale detection & follow-up
│   └── token-purchase-detector.ts # Whale token purchase analysis
├── cache/
│   └── cache-service.ts           # Redis cache for token transfers & RPC blocks
├── database/
│   └── db.ts                      # PostgreSQL connection & migrations
├── fetchers/
│   ├── rpc-fetcher.ts             # RPC blockchain data fetcher
│   ├── price-fetcher.ts           # CoinGecko price fetcher
│   ├── supply-fetcher.ts          # Token supply fetcher
│   ├── token-transfer-fetcher.ts  # ERC-20 Transfer event fetcher
│   └── hybrid-connection.ts       # WebSocket + Polling fallback manager
├── metrics/
│   └── metrics-service.ts         # Prometheus metrics endpoint
├── queue/
│   └── queue-service.ts           # BullMQ job queue for async processing
├── tokens/
│   └── token-registry.ts          # Token contract registry per chain
├── reporters/
│   ├── console-reporter.ts        # Console output
│   └── telegram-reporter.ts       # Telegram notifications
├── scrapers/
│   └── arkham-scraper.ts          # Arkham Intelligence scraper
├── signals/
│   └── signal-generator.ts        # Market signal generation
└── notifications/
    └── notification-manager.ts    # Notification deduplication

data/
└── known-addresses.json           # Pre-labeled addresses (exchange, cold/hot wallet, DeFi)
```

## Coding Conventions

### Language
- **Code**: English (variable names, function names, comments)
- **User-facing messages**: Indonesian (Telegram notifications, console output)
- **Documentation**: Indonesian (README, AGENTS.md)

### TypeScript
- Use strict TypeScript
- Prefer interfaces over types for object shapes
- Use `async/await` over raw promises
- Handle errors with try/catch

### Naming Conventions
- **Files**: kebab-case (`token-purchase-detector.ts`)
- **Classes**: PascalCase (`TokenPurchaseDetector`)
- **Functions**: camelCase (`fetchTokenTransfers`)
- **Constants**: UPPER_SNAKE_CASE (`TRANSFER_TOPIC`)
- **Interfaces**: PascalCase (`WhaleTokenPurchase`)

### Imports
- Group imports: external libraries first, then internal modules
- Use absolute imports from project root

## Architecture

### Multi-Chain Support
- Ethereum (chainId: 1)
- BSC (chainId: 56)
- Polygon (chainId: 137)
- Arbitrum (chainId: 42161)
- Avalanche (chainId: 43114)
- Optimism (chainId: 10)

### Label Types
| Type | Description |
|------|-------------|
| `cex` | Centralized Exchange |
| `dex` | Decentralized Exchange |
| `cold_wallet` | Cold Wallet (long-term storage) |
| `hot_wallet` | Hot Wallet (active trading) |
| `whale` | Whale address |
| `market_maker` | Market maker |
| `bridge` | Cross-chain bridge |
| `lending` | Lending protocol |
| `liquid_staking` | Liquid staking |
| `wrapped` | Wrapped token |

### Transfer Direction Detection
| Direction | Description |
|-----------|-------------|
| `exchange_to_cold` | Exchange → Cold Wallet (accumulation) |
| `cold_to_exchange` | Cold Wallet → Exchange (selling) |
| `whale_to_exchange` | Whale → Exchange (potential selling) |
| `exchange_to_whale` | Exchange → Whale (accumulation) |

## Key Files

### Configuration
- `.env` - Environment variables (RPC URLs, Telegram token, database URL)
- `src/config.ts` - Chain configuration and settings
- `data/known-addresses.json` - Pre-labeled addresses

### Core Logic
- `src/analyzers/transaction-analyzer.ts` - Main analysis engine
- `src/analyzers/whale-tracker.ts` - Whale detection and tracking
- `src/analyzers/token-purchase-detector.ts` - Token purchase analysis

### Data Fetching
- `src/fetchers/rpc-fetcher.ts` - RPC blockchain data
- `src/fetchers/token-transfer-fetcher.ts` - ERC-20 Transfer events
- `src/tokens/token-registry.ts` - Token contract metadata

### Output
- `src/reporters/telegram-reporter.ts` - Telegram notifications
- `src/reporters/console-reporter.ts` - Console output

## Database Tables

| Table | Description |
|-------|-------------|
| `monitored_transfers` | Transaction history |
| `market_signals` | Generated market signals |
| `known_addresses` | Labeled addresses |
| `whale_tracking` | Tracked whale wallets |
| `whale_token_purchases` | Token purchases by whales |

## Common Tasks

### Adding New CEX Addresses
1. Edit `data/known-addresses.json`
2. Add address to `exchanges` section with type `cex`
3. Add corresponding `cold_wallets` and `hot_wallets` entries

### Adding New Token Contracts
1. Edit `src/tokens/token-registry.ts`
2. Add token info to `KNOWN_TOKENS` array
3. Include: address, chainId, name, symbol, decimals, coingeckoId

### Modifying Telegram Messages
1. Edit `src/reporters/telegram-reporter.ts`
2. Use `getTypeLabel()` for consistent type labels
3. Use `analyzeDestination()` for transfer analysis
4. Keep messages in Indonesian

## Environment Variables

```env
# Required - at least 1 RPC URL
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
BSC_RPC_URL=https://bsc-mainnet.g.alchemy.com/v2/YOUR_KEY

# Chain IDs to monitor (comma-separated)
MONITORED_CHAINS=1,56,137

# Monitoring config
POLL_INTERVAL_MS=60000
MIN_TX_VALUE_USD=100000

# Optional - PostgreSQL
DATABASE_URL=postgresql://user:password@host:port/railway

# Optional - Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Optional - WebSocket (Hybrid Mode)
ETH_WS_URL=wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ENABLE_WEBSOCKET=true

# Optional - Redis (for caching & job queue)
REDIS_URL=redis://default:password@redis.railway.internal:6379
ENABLE_JOB_QUEUE=true

# Optional - Prometheus Metrics
METRICS_PORT=9090
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `ethers` | Ethereum blockchain interaction |
| `telegraf` | Telegram bot |
| `pg` | PostgreSQL database |
| `axios` | HTTP requests |
| `pino` | Logging |
| `redis` | Redis cache client |
| `ioredis` | Redis client for BullMQ |
| `bullmq` | Job queue for async processing |
| `prom-client` | Prometheus metrics |

## Git Conventions

### Commit Messages
```
feat: add new feature
fix: fix bug
docs: update documentation
refactor: refactor code
chore: maintenance tasks
```

### Branch Naming
```
feature/description
bugfix/description
hotfix/description
```
